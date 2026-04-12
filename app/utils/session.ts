import { nanoid } from "nanoid";
import { getMessageTextContent, getTextContent, trimTopic } from "../utils";
import type { ChatMessage } from "../store/message";
import type { ChatSession } from "../store/chat";
import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi } from "../client/api";
import { useChatStore } from "../store/chat";
import Locale from "../locales";
import { buildMultimodalContent } from "./chat";
import { systemMessageStorage } from "../store/system";
import { parseGroupMessageId } from "./group";
import { messageStorage } from "../store/message";
import { SESSION_TITLE_MODEL } from "../constant";

// 定义默认主题，避免循环依赖
const DEFAULT_TOPIC = Locale.Session.Title.Default;

function getModelForTitleGeneration(): string {
  const models = useChatStore.getState().models;
  if (models.includes(SESSION_TITLE_MODEL)) return SESSION_TITLE_MODEL;
  return models[0] ?? SESSION_TITLE_MODEL;
}

/**
 * 计算会话状态
 */
export function calculateSessionStatus(
  session: ChatSession,
): "normal" | "error" | "pending" {
  const messages = session.messages;
  if (messages.length === 0) return "normal";
  const lastMessage = messages[messages.length - 1];
  // 如果最后一条消息有错误，返回错误状态
  if (lastMessage.isError) return "error";
  // 如果最后一条消息是用户消息，返回用户待回复状态
  else if (lastMessage.role === "user") return "pending";
  // 其他情况返回正常状态
  else return "normal";
}

/**
 * 更新会话计数和状态
 */
export function updateSessionStatsBasic(session: ChatSession): void {
  // 系统提示词存储在 IndexedDB 中，这里我们暂时只计算基础消息数量；实际的系统提示词检查将在异步场景中处理
  session.messageCount = session.messages.length;
  session.status = calculateSessionStatus(session);
}

/**
 * 异步更新会话计数和状态（包含系统提示词检查）
 */
export async function updateSessionStats(session: ChatSession): Promise<void> {
  session.messageCount = session.messages.length;
  session.status = calculateSessionStatus(session);
  // 检查系统提示词是否存在且有效
  if (await checkHasSystemPrompt(session.id)) session.messageCount += 1;
}

/**
 * 创建消息对象
 */
export function createMessage(
  override: Partial<ChatMessage>,
  batchId?: string,
  forceGroupMessage?: boolean, // 新增：强制指定是否为组内会话消息
): ChatMessage {
  // 检查是否为组内会话消息
  let isGroupMessage = forceGroupMessage ?? false;

  // 如果没有强制指定，则自动检测
  if (forceGroupMessage === undefined) {
    try {
      if (typeof window !== "undefined") {
        const currentSession = useChatStore.getState().currentSession();
        isGroupMessage =
          currentSession?.groupId !== null &&
          currentSession?.groupId !== undefined;
      }
    } catch (error) {
      // 如果获取当前会话失败，默认为非组内会话
      isGroupMessage = false;
    }
  }

  // 创建消息 ID
  let messageId: string;
  const msgId = nanoid(21); // 21位messageId
  // 组内会话使用格式：{12位batchId}_{21位messageId}
  if (isGroupMessage) messageId = `${batchId || nanoid(12)}_${msgId}`;
  // 普通会话使用格式：{21位messageId}
  else messageId = msgId;

  return {
    id: messageId,
    role: "user",
    content: "",
    date: new Date().toLocaleString(),
    ...override,
  };
}

/**
 * 创建空的会话对象
 */
export function createEmptySession(): ChatSession {
  const getDefaultModel = () => {
    try {
      const models = useChatStore.getState().models;
      if (models.length === 0) {
        // 如果模型列表为空，返回一个占位符，让客户端处理
        return "loading";
      }
      return models[0];
    } catch (error) {
      // 如果无法获取模型列表，返回占位符
      return "loading";
    }
  };
  return {
    id: nanoid(),
    title: DEFAULT_TOPIC,
    sourceName: undefined, // 空会话没有源文件名
    messages: [],
    messageCount: 0,
    status: "normal",
    lastUpdate: Date.now(),
    model: getDefaultModel(),
    longInputMode: false,
    ignoreSystemPrompt: false,
    useMemory: false,
    isModelManuallySelected: false,
    isFavorite: false,
    groupId: null,
  };
}

/**
 * 计算消息总文本长度
 */
export function calculateMessagesTextLength(msgs: ChatMessage[]): number {
  return msgs.reduce((pre, cur) => pre + getMessageTextContent(cur).length, 0);
}

/**
 * 创建分支会话
 */
export function createBranchSession(
  originalSession: ChatSession,
  messagesToCopy: ChatMessage[],
  branchTopic: string,
): ChatSession {
  const newSession = createEmptySession();
  newSession.title = branchTopic;
  newSession.messages = [...messagesToCopy];
  newSession.longInputMode = originalSession.longInputMode;
  newSession.ignoreSystemPrompt = originalSession.ignoreSystemPrompt;
  newSession.useMemory = originalSession.useMemory ?? false;
  newSession.isModelManuallySelected = originalSession.isModelManuallySelected;
  newSession.model = originalSession.model;
  // 更新消息计数和状态
  updateSessionStatsBasic(newSession);
  return newSession;
}

/**
 * 获取包含内存的消息列表
 */
export async function prepareMessagesForApi(
  session: ChatSession,
): Promise<ChatMessage[]> {
  const messages = [...session.messages];

  // ========== system message 动态加载 ==========
  let systemPrompt: ChatMessage[] = [];

  // 只有当 ignoreSystemPrompt 为 false 或 undefined 时才加载系统提示词
  if (!session.ignoreSystemPrompt) {
    // 直接从 systemMessageStorage 加载系统提示词，不依赖 messages 中的 system 消息
    try {
      const systemMessage = await systemMessageStorage.get(session.id);

      const hasSystemMessage =
        systemMessage &&
        (systemMessage.text.trim() !== "" || systemMessage.images.length > 0);

      // 只有当有有效内容时才创建 system 消息
      if (hasSystemMessage) {
        // 使用新格式的数据构建 multimodalContent
        const mContent = buildMultimodalContent(
          systemMessage.text,
          systemMessage.images,
        );

        // 创建 system 消息（仅用于发送给 API，不存储在 session.messages 中）
        systemPrompt = [
          createMessage({
            role: "system",
            content: mContent,
          }),
        ];
      }
    } catch (error) {
      console.error("[prepareMessagesForApi] 加载系统提示词失败:", error);
    }
  }

  // 获取所有消息（除了错误消息和系统消息）
  const recentMessages = messages.filter(
    (msg) => !msg.isError && msg.role !== "system",
  );

  // 合并所有消息，包含动态加载的 system message
  const finalMessages = [...systemPrompt, ...recentMessages];

  return finalMessages;
}

/**
 * 会话摘要生成
 */
export async function generateSessionTitle(
  session: ChatSession,
  forceRefresh: boolean = false,
  onSessionTitleUpdate?: (topic: string) => void,
): Promise<void> {
  const TRIGGER_MIN_LEN = 50;

  const model = getModelForTitleGeneration();
  const api: ClientApi = getClientApi();
  const messages = (session.messages || []).slice();

  // 触发条件判断
  const isDefaultTitle =
    session.title === DEFAULT_TOPIC ||
    session.title === Locale.Session.Title.DefaultGroup;

  const messagesTextLengthReached =
    calculateMessagesTextLength(messages) >= TRIGGER_MIN_LEN;

  // 无任何消息时不要发请求，否则模型只看到「请为以上对话生成…」会复述成「生成概述标题」等
  if (messages.length === 0 && (isDefaultTitle || forceRefresh)) {
    const fallbackTitle =
      session.title === Locale.Session.Title.DefaultGroup
        ? Locale.Session.Title.DefaultGroup
        : DEFAULT_TOPIC;
    onSessionTitleUpdate?.(fallbackTitle);
    return;
  }

  if ((isDefaultTitle && messagesTextLengthReached) || forceRefresh) {
    // 会话标题
    let sessionTitle: string | MultimodalContent[] = "";

    api.llm.chat({
      messages: messages.concat(
        createMessage({
          role: "user",
          content: Locale.Session.Title.RefreshPrompt,
        }),
      ),
      model,
      onUpdate(message) {
        if (message) {
          sessionTitle = message;
        }
      },
      onFinish(message, responseRes, usage) {
        const finalMessage = message || sessionTitle;
        if (responseRes?.status === 200 && finalMessage) {
          // 根据原始会话标题类型选择正确的默认标题
          const fallbackTitle =
            session.title === Locale.Session.Title.DefaultGroup
              ? Locale.Session.Title.DefaultGroup
              : DEFAULT_TOPIC;

          const newTitle =
            finalMessage.length > 0
              ? trimTopic(getTextContent(finalMessage))
              : fallbackTitle;
          onSessionTitleUpdate?.(newTitle);
        }
      },
    });
  }
}

/**
 * 根据给定消息列表生成简短标题（用于分享页等），与会话原标题分离。
 * 使用与会话标题相同的 prompt，仅输入消息不同。
 */
export async function generateTitleFromMessages(
  messages: ChatMessage[],
  onDone: (title: string) => void,
): Promise<void> {
  const filtered = (messages || []).filter(
    (m) => !m.isError && (m.role === "user" || m.role === "assistant"),
  );
  if (filtered.length === 0) {
    onDone(Locale.Session.Title.Default);
    return;
  }

  const model = getModelForTitleGeneration();
  const api: ClientApi = getClientApi();
  let out: string | MultimodalContent[] = "";

  api.llm.chat({
    messages: filtered.concat(
      createMessage({
        role: "user",
        content: Locale.Session.Title.RefreshPrompt,
      }),
    ),
    model,
    onUpdate(message) {
      if (message) out = message;
    },
    onFinish(message, responseRes) {
      const final = message || out;
      if (responseRes?.status === 200 && final) {
        const title =
          (typeof final === "string"
            ? final
            : getTextContent(final as MultimodalContent[]).trim()) || "";
        onDone(trimTopic(title) || Locale.Session.Title.Default);
      } else {
        onDone(Locale.Session.Title.Default);
      }
    },
  });
}

/**
 * 准备发送的消息列表
 */
export function prepareSendMessages(
  recentMessages: ChatMessage[],
  userMessage: ChatMessage,
  messageIdx?: number,
): ChatMessage[] {
  // 🔧 关键修复：如果 recentMessages 已经包含系统消息，说明它来自 prepareMessagesForApi
  // 这种情况下我们不应该重新处理系统消息，只需要处理 messageIdx 的截取逻辑
  const hasSystemMessage = recentMessages.some((m) => m.role === "system");

  if (hasSystemMessage) {
    let finalMessages: ChatMessage[];

    if (typeof messageIdx === "number" && messageIdx >= 0) {
      // 对于重试场景，我们需要截取到指定位置，但保留系统消息
      const systemMessages = recentMessages.filter((m) => m.role === "system");
      const nonSystemMessages = recentMessages.filter(
        (m) => m.role !== "system",
      );
      const truncatedNonSystemMessages = nonSystemMessages.slice(0, messageIdx);

      finalMessages = [
        ...systemMessages,
        ...truncatedNonSystemMessages,
        userMessage,
      ];
    } else {
      // 正常发送，直接添加用户消息
      finalMessages = [...recentMessages, userMessage];
    }

    return finalMessages;
  }

  // 🔧 旧逻辑：当 recentMessages 不包含系统消息时的处理
  // 这通常发生在某些边缘情况或兼容性场景中
  const systemMessages = recentMessages.filter((m) => m.role === "system");
  const nonSystemMessages = recentMessages.filter((m) => m.role !== "system");

  let finalNonSystemMessages: ChatMessage[];

  if (typeof messageIdx === "number" && messageIdx >= 0) {
    // messageIdx 只影响非系统消息的截取
    finalNonSystemMessages = nonSystemMessages.slice(0, messageIdx);
  } else {
    finalNonSystemMessages = nonSystemMessages;
  }

  // **关键修复：系统消息总是包含在最前面**
  const finalMessages = [
    ...systemMessages,
    ...finalNonSystemMessages,
    userMessage,
  ];

  return finalMessages;
}

/**
 * 处理消息插入逻辑
 */
export function insertMessage(
  messages: ChatMessage[],
  userMessage: ChatMessage,
  modelMessage: ChatMessage,
  messageIdx?: number,
): ChatMessage[] {
  if (typeof messageIdx === "number" && messageIdx >= 0) {
    // 🔧 修复：当指定了 messageIdx 时，在该位置插入用户消息和模型消息
    const insertIdx = Math.min(messageIdx, messages.length);

    // 在指定位置插入用户消息和模型消息
    return [
      ...messages.slice(0, insertIdx),
      userMessage,
      modelMessage,
      ...messages.slice(insertIdx),
    ];
  } else {
    // 没有入参 messageIdx，插入到末尾
    return messages.concat([userMessage, modelMessage]);
  }
}

/**
 * 计算会话移动后的新索引
 */
export function calculateMoveIndex(
  from: number,
  to: number,
  currentIndex: number,
): number {
  let newIndex = currentIndex === from ? to : currentIndex;
  if (currentIndex > from && currentIndex <= to) {
    newIndex -= 1;
  } else if (currentIndex < from && currentIndex >= to) {
    newIndex += 1;
  }
  return newIndex;
}

/**
 * 验证会话索引
 */
export function validateSessionIndex(
  index: number,
  sessionsLength: number,
): number {
  if (index < 0 || index >= sessionsLength) {
    return Math.min(sessionsLength - 1, Math.max(0, index));
  }
  return index;
}

// 工具函数：只移除同 batchId 的用户消息，不添加
export function filterOutUserMessageByBatchId(
  messages: ChatMessage[],
  batchId: string,
): ChatMessage[] {
  return messages.filter((m) => {
    const parsed = parseGroupMessageId(m.id);
    return !(parsed.isValid && parsed.batchId === batchId && m.role === "user");
  });
}

/**
 * 检查指定 sessionId 是否有有效的系统提示词
 */
export async function checkHasSystemPrompt(
  sessionId: string,
): Promise<boolean> {
  try {
    const systemData = await systemMessageStorage.get(sessionId);
    return !!(
      systemData &&
      (systemData.text.trim() !== "" || systemData.images.length > 0)
    );
  } catch (error) {
    console.error("[checkHasSystemPrompt] 检查系统提示词失败:", error);
    return false;
  }
}

// ==============================
// 会话层指标聚合
// ==============================
export interface SessionAggregatedMetrics {
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgTtft: number | null;
  avgTotalTime: number | null;
  weightedTps: number | null;
  sampleCounts: {
    assistantMessages: number;
    ttft: number;
    totalTime: number;
    tps: number; // 有效样本数（当使用简单平均时可用）
  };
}

/**
 * 聚合会话内模型消息的统计指标
 * - 默认仅统计已完成消息（streaming !== true）且 role === "assistant"
 * - 加权 TPS = sum(completion_tokens) / sum(max(total_time - ttft, 0))
 */
export function aggregateSessionMetrics(
  session: ChatSession,
  options?: { includeStreaming?: boolean },
): SessionAggregatedMetrics {
  const includeStreaming = options?.includeStreaming === true;

  let totalCost = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  let sumTtft = 0;
  let sumTotalTime = 0;
  let cntTtft = 0;
  let cntTotalTime = 0;

  let weightedTpsNumerator = 0; // sum(completion_tokens)
  let weightedTpsDenominator = 0; // sum(max(total_time - ttft, 0))

  let cntAssistant = 0;
  let cntTps = 0; // 仅用于备用的简单平均

  for (const m of session.messages) {
    if (m.role !== "assistant") continue;
    if (!includeStreaming && m.streaming) continue;
    if (m.isError) continue;

    cntAssistant += 1;

    if (typeof m.cost === "number") totalCost += m.cost;
    if (typeof m.prompt_tokens === "number")
      totalPromptTokens += m.prompt_tokens;
    if (typeof m.completion_tokens === "number")
      totalCompletionTokens += m.completion_tokens;

    if (typeof m.ttft === "number") {
      sumTtft += m.ttft;
      cntTtft += 1;
    }
    if (typeof m.total_time === "number") {
      sumTotalTime += m.total_time;
      cntTotalTime += 1;
    }

    // 加权 TPS 累加器
    if (
      typeof m.completion_tokens === "number" &&
      typeof m.total_time === "number" &&
      typeof m.ttft === "number"
    ) {
      const effective = Math.max(m.total_time - m.ttft, 0);
      if (effective > 0) {
        weightedTpsNumerator += m.completion_tokens;
        weightedTpsDenominator += effective;
        cntTps += 1;
      }
    }
  }

  const avgTtft =
    cntTtft > 0 ? Math.round((sumTtft / cntTtft) * 100) / 100 : null;
  const avgTotalTime =
    cntTotalTime > 0
      ? Math.round((sumTotalTime / cntTotalTime) * 100) / 100
      : null;
  const weightedTps =
    weightedTpsDenominator > 0
      ? Math.round((weightedTpsNumerator / weightedTpsDenominator) * 100) / 100
      : null;

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalPromptTokens,
    totalCompletionTokens,
    avgTtft,
    avgTotalTime,
    weightedTps,
    sampleCounts: {
      assistantMessages: cntAssistant,
      ttft: cntTtft,
      totalTime: cntTotalTime,
      tps: cntTps,
    },
  };
}

/**
 * 过滤指定组内的空会话（标题为默认、系统提示词为空、消息列表为空）
 */
export async function filterEmptyGroupSessions(groupId: string) {
  const chatStore = useChatStore.getState();
  const { groups, groupSessions, chatListGroupView } = chatStore;
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;

  const defaultTitle = Locale.Session.Title.DefaultGroup;

  // 新的 sessionIds 和 groupSessions
  const newSessionIds: string[] = [];
  const sessionsToDelete: string[] = [];

  for (const sessionId of group.sessionIds) {
    const session = groupSessions[sessionId];
    if (!session) continue;
    // 1. 标题为默认
    const isDefaultTitle = session.title === defaultTitle;
    // 2. 系统提示词为空
    const sysMsg = await systemMessageStorage.get(sessionId);
    const isSystemEmpty =
      !sysMsg.text.trim() && (!sysMsg.images || sysMsg.images.length === 0);
    // 3. 消息列表为空
    const msgs = await messageStorage.get(sessionId);
    const isMsgEmpty = !msgs || msgs.length === 0;
    if (isDefaultTitle && isSystemEmpty && isMsgEmpty) {
      sessionsToDelete.push(sessionId);
    } else {
      newSessionIds.push(sessionId);
    }
  }

  if (sessionsToDelete.length > 0) {
    // 删除空会话的消息和系统提示词
    for (const sessionId of sessionsToDelete) {
      await messageStorage.delete(sessionId);
      await systemMessageStorage.delete(sessionId);
    }

    // 计算新的 currentSessionIndex，确保不超出范围
    let newCurrentSessionIndex = group.currentSessionIndex;
    if (newCurrentSessionIndex >= newSessionIds.length) {
      newCurrentSessionIndex = Math.max(0, newSessionIds.length - 1);
    }

    // 更新 group 和 groupSessions
    useChatStore.setState((state) => {
      const newGroupSessions = { ...state.groupSessions };
      for (const sessionId of sessionsToDelete) {
        delete newGroupSessions[sessionId];
      }
      const groupIdx = state.groups.findIndex((g) => g.id === groupId);
      if (groupIdx === -1) return {};
      const newGroups = [...state.groups];
      newGroups[groupIdx] = {
        ...state.groups[groupIdx],
        sessionIds: newSessionIds,
        messageCount: newSessionIds.length,
        currentSessionIndex: newCurrentSessionIndex, // 确保索引有效
      };
      return {
        groupSessions: newGroupSessions,
        groups: newGroups,
        // 保持当前的视图状态，不要意外切换回 groups view
        chatListGroupView: state.chatListGroupView,
      };
    });
  }
}
