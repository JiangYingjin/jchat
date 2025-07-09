import { nanoid } from "nanoid";
import { getMessageTextContent, getTextContent, trimTopic } from "../utils";
import type { ChatMessage, ChatSession, ChatStat } from "../store/chat";
import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi } from "../client/api";
import { estimateTokenLength } from "./token";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { getModelList } from "./model";
import { DEFAULT_MODELS } from "../constant";
import Locale from "../locales";
import { buildMultimodalContent } from "./chat";

// 定义默认主题，避免循环依赖
const DEFAULT_TOPIC = Locale.Store.DefaultTopic;

/**
 * 创建消息对象
 */
export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

/**
 * 创建空的会话对象
 */
export function createEmptySession(): ChatSession {
  const config = useAppConfig.getState();
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    messages: [],
    stat: {
      tokenCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    model: config.modelConfig.model,
    longInputMode: false,
    isModelManuallySelected: false,
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

  newSession.topic = branchTopic;
  newSession.messages = [...messagesToCopy];
  newSession.longInputMode = originalSession.longInputMode;
  newSession.isModelManuallySelected = originalSession.isModelManuallySelected;
  newSession.model = originalSession.model;

  return newSession;
}

/**
 * 获取包含内存的消息列表
 */
export async function getMessagesWithMemory(
  session: ChatSession,
  systemMessageStorage?: any,
): Promise<ChatMessage[]> {
  const messages = session.messages.slice();

  // ========== system message 动态加载 ==========
  let systemMessage: ChatMessage | undefined = messages.find(
    (m) => m.role === "system",
  );
  let systemPrompt: ChatMessage[] = [];

  if (systemMessage && systemMessageStorage) {
    let content = systemMessage.content;
    if (!content && (systemMessage as any).contentKey) {
      // 动态从 IndexedDB 取
      const storedData = await systemMessageStorage.getSystemMessage(
        session.id,
      );
      // 只有当IndexedDB中有内容时才使用，否则跳过该系统消息
      if (
        storedData &&
        (storedData.text.trim() !== "" || storedData.images.length > 0)
      ) {
        // 使用新格式的数据构建 multimodalContent
        const multimodalContent = buildMultimodalContent(
          storedData.text,
          storedData.images,
        );
        content = multimodalContent;
      }
    }

    if (
      content &&
      (typeof content === "string" ? content.trim() !== "" : content.length > 0)
    ) {
      let multimodalContent: MultimodalContent[];
      if (typeof content === "string") {
        try {
          const data = JSON.parse(content);
          if (
            typeof data === "object" &&
            (data.content !== undefined || data.images !== undefined)
          ) {
            multimodalContent = buildMultimodalContent(
              data.content,
              data.images,
            );
          } else {
            multimodalContent = buildMultimodalContent(content, []);
          }
        } catch (e) {
          multimodalContent = buildMultimodalContent(content, []);
        }
      } else {
        multimodalContent = content;
      }
      systemPrompt = [
        {
          ...systemMessage,
          content: multimodalContent,
        },
      ];
    }
  }

  // 获取所有消息（除了错误消息和系统消息）
  const recentMessages = messages.filter(
    (msg) => !msg.isError && msg.role !== "system",
  );

  // 合并所有消息，包含动态加载的 system message
  return [...systemPrompt, ...recentMessages];
}

/**
 * 会话摘要生成
 */
export async function summarizeSession(
  session: ChatSession,
  refreshTitle: boolean = false,
  onTopicUpdate?: (topic: string) => void,
): Promise<void> {
  // 直接使用全局默认模型进行总结
  const accessStore = useAccessStore.getState();
  const allModel = getModelList(accessStore.models);
  const model = allModel.length > 0 ? allModel[0].name : DEFAULT_MODELS[0];

  const api: ClientApi = getClientApi();

  // remove error messages if any
  const messages = session.messages;

  // should summarize topic after chating more than 50 words
  const SUMMARIZE_MIN_LEN = 50;
  if (
    (!process.env.NEXT_PUBLIC_DISABLE_AUTOGENERATETITLE &&
      session.topic === DEFAULT_TOPIC &&
      countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
    refreshTitle
  ) {
    const topicMessages = messages.concat(
      createMessage({
        role: "user",
        content: Locale.Store.Prompt.Topic,
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
          const newTopic =
            finalMessage.length > 0
              ? trimTopic(getTextContent(finalMessage))
              : DEFAULT_TOPIC;
          onTopicUpdate?.(newTopic);
        }
      },
    });
  }
}

/**
 * 更新会话统计信息
 */
export function updateSessionStat(
  message: ChatMessage,
  session: ChatSession,
  usage?: any,
): Partial<ChatStat> {
  const updates: Partial<ChatStat> = {};

  // 更新 tokenCount
  if (usage?.completion_tokens) {
    updates.tokenCount = usage.completion_tokens;
  }

  // 更新字符数
  updates.charCount = (session.stat.charCount || 0) + message.content.length;

  return updates;
}

/**
 * 准备发送的消息列表
 */
export function prepareSendMessages(
  recentMessages: ChatMessage[],
  userMessage: ChatMessage,
  messageIdx?: number,
): ChatMessage[] {
  if (typeof messageIdx === "number" && messageIdx >= 0) {
    // 只取到 messageIdx（含）为止的消息
    return recentMessages.slice(0, messageIdx).concat(userMessage);
  } else {
    return recentMessages.concat(userMessage);
  }
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
