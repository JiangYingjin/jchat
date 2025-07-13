import { nanoid } from "nanoid";
import { getMessageTextContent, getTextContent, trimTopic } from "../utils";
import type { ChatMessage } from "../store/message";
import type { ChatSession } from "../store/chat";
import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi } from "../client/api";
import { estimateTokenLength } from "./token";
import { useChatStore } from "../store/chat";
import Locale from "../locales";
import { buildMultimodalContent } from "./chat";
import { FALLBACK_MODEL } from "../constant";
import { systemMessageStorage } from "../store/system";

// 定义默认主题，避免循环依赖
const DEFAULT_TOPIC = Locale.Session.Title.Default;

/**
 * 计算会话状态
 */
export function calculateSessionStatus(
  messages: ChatMessage[],
): "normal" | "error" | "pending" {
  if (messages.length === 0) {
    return "normal";
  }

  const lastMessage = messages[messages.length - 1];

  // 如果最后一条消息有错误，返回错误状态
  if (lastMessage.isError) {
    return "error";
  }

  // 如果最后一条消息是用户消息，返回用户待回复状态
  if (lastMessage.role === "user") {
    return "pending";
  }

  // 其他情况返回正常状态
  return "normal";
}

/**
 * 更新会话计数和状态
 */
export function updateSessionStats(session: ChatSession): void {
  // 基础消息数量
  const baseMessageCount = session.messages.length;

  // 检查系统提示词是否存在且有效
  // 由于这是同步函数，我们使用一个简单的检查方式
  // 系统提示词存储在 IndexedDB 中，这里我们暂时只计算基础消息数量
  // 实际的系统提示词检查将在异步场景中处理
  session.messageCount = baseMessageCount;
  session.status = calculateSessionStatus(session.messages);
}

/**
 * 异步更新会话计数和状态（包含系统提示词检查）
 */
export async function updateSessionStatsAsync(
  session: ChatSession,
): Promise<void> {
  // 基础消息数量
  const baseMessageCount = session.messages.length;

  // 检查系统提示词是否存在且有效
  let hasSystemPrompt = false;
  try {
    const systemData = await systemMessageStorage.get(session.id);
    hasSystemPrompt =
      systemData &&
      (systemData.text.trim() !== "" || systemData.images.length > 0);
  } catch (error) {
    console.error("[updateSessionStatsAsync] 检查系统提示词失败:", error);
    hasSystemPrompt = false;
  }

  // 如果系统提示词不为空，则 +1，否则为消息列表长度
  session.messageCount = hasSystemPrompt
    ? baseMessageCount + 1
    : baseMessageCount;
  session.status = calculateSessionStatus(session.messages);
}

/**
 * 创建消息对象
 */
export function createMessage(
  override: Partial<ChatMessage>,
  batchId?: string,
): ChatMessage {
  // 检查是否为组内会话消息
  let isGroupMessage = false;

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

  let messageId: string;

  if (isGroupMessage) {
    // 组内会话使用格式：{12位batchId}_{21位messageId}
    const finalBatchId = batchId || nanoid(12); // 使用传入的batchId或生成新的
    const msgId = nanoid(21); // 21位messageId
    messageId = `${finalBatchId}_${msgId}`;
  } else {
    // 普通会话使用原来的nanoid格式
    messageId = nanoid();
  }

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
      return useChatStore.getState().models[0];
    } catch (error) {
      return FALLBACK_MODEL;
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
    isModelManuallySelected: false,
    groupId: null,
  };
}

/**
 * 计算消息总token数
 */
export function countMessages(msgs: ChatMessage[]): number {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
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
  newSession.isModelManuallySelected = originalSession.isModelManuallySelected;
  newSession.model = originalSession.model;
  // 更新消息计数和状态
  updateSessionStats(newSession);
  return newSession;
}

/**
 * 获取包含内存的消息列表
 */
export async function prepareMessagesForApi(
  session: ChatSession,
  systemMessageStorage?: any,
): Promise<ChatMessage[]> {
  const messages = session.messages.slice();

  // ========== system message 动态加载 ==========
  let systemPrompt: ChatMessage[] = [];

  // 直接从 systemMessageStorage 加载系统提示词，不依赖 messages 中的 system 消息
  if (systemMessageStorage) {
    try {
      const storedData = await systemMessageStorage.get(session.id);

      // 只有当有有效内容时才创建 system 消息
      if (
        storedData &&
        (storedData.text.trim() !== "" || storedData.images.length > 0)
      ) {
        // 使用新格式的数据构建 multimodalContent
        const multimodalContent = buildMultimodalContent(
          storedData.text,
          storedData.images,
        );

        // 创建 system 消息（仅用于发送给 API，不存储在 session.messages 中）
        systemPrompt = [
          createMessage({
            role: "system",
            content: multimodalContent,
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
  refreshTitle: boolean = false,
  onTopicUpdate?: (topic: string) => void,
): Promise<void> {
  // 直接使用全局默认模型进行总结
  const chatStore = useChatStore.getState();
  const model = chatStore.models[0];

  const api: ClientApi = getClientApi();

  // remove error messages if any
  const messages = session.messages;

  // should summarize topic after chating more than 50 words
  const SUMMARIZE_MIN_LEN = 50;
  if (
    ((session.title === DEFAULT_TOPIC ||
      session.title === Locale.Session.Title.DefaultGroup) &&
      countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
    refreshTitle
  ) {
    const topicMessages = messages.concat(
      createMessage({
        role: "user",
        content: Locale.Session.Title.RefreshPrompt,
      }),
    );
    let topicContent: string | MultimodalContent[] = "";

    api.llm.chat({
      messages: topicMessages,
      config: {
        model,
        stream: true,
      },
      onUpdate(message) {
        if (message) {
          topicContent = message;
        }
      },
      onFinish(message, responseRes, usage) {
        const finalMessage = message || topicContent;
        if (responseRes?.status === 200 && finalMessage) {
          // 根据原始会话标题类型选择正确的默认标题
          const fallbackTitle =
            session.title === Locale.Session.Title.DefaultGroup
              ? Locale.Session.Title.DefaultGroup
              : DEFAULT_TOPIC;

          const newTopic =
            finalMessage.length > 0
              ? trimTopic(getTextContent(finalMessage))
              : fallbackTitle;
          onTopicUpdate?.(newTopic);
        }
      },
    });
  }
}

/**
 * 准备发送的消息列表
 */
export function prepareSendMessages(
  recentMessages: ChatMessage[],
  userMessage: ChatMessage,
  messageIdx?: number,
): ChatMessage[] {
  // **修复：分离系统消息和普通消息**
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
    // 入参 messageIdx，插入到指定位置
    const insertIdx = Math.min(messageIdx, messages.length);
    // 要确定 messageIdx+1 位置消息的 role 是否为 assistant
    const nextMessage = messages[insertIdx + 1];
    if (nextMessage && nextMessage.role === "assistant") {
      // 如果 nextMessage 是 assistant，则插入到 nextMessage 后面
      return [
        ...messages.slice(0, insertIdx + 1),
        modelMessage,
        ...messages.slice(insertIdx + 2),
      ];
    } else {
      // 如果 nextMessage 不是 assistant，则插入到 nextMessage 前面
      return [
        ...messages.slice(0, insertIdx + 1),
        modelMessage,
        ...messages.slice(insertIdx + 1),
      ];
    }
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
