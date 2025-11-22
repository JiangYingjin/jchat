import { nanoid } from "nanoid";
import type { ChatGroup } from "../store/chat";
import { createEmptySession } from "./session";
import Locale from "../locales";
import type { ChatMessage } from "../store";
import pLimit from "p-limit";
import {
  copyToClipboard,
  getMessageTextContent,
  getMessageImages,
} from "../utils";
import { messageStorage } from "../store/message";

/**
 * 组内会话消息ID解析工具
 * 格式：{12位batchId}_{21位messageId}
 */

export interface GroupMessageId {
  batchId: string;
  messageId: string;
  isValid: boolean;
}

/**
 * 创建空的组对象
 * 会同时创建一个空的会话并插入到 chatStore.groupSessions 中
 */
export function createEmptyGroup(): ChatGroup {
  const emptySession = createEmptySession();
  const group: ChatGroup = {
    id: nanoid(),
    title: Locale.Session.Title.DefaultGroup,
    sessionIds: [emptySession.id],
    messageCount: emptySession.messageCount,
    status: "normal",
    pendingCount: 0,
    errorCount: 0,
    currentSessionIndex: 0,
  };
  // 设置会话的 groupId
  emptySession.groupId = group.id;

  return group;
}

/**
 * 根据 pendingCount 和 errorCount 推断并更新 group 的 status
 * 这个函数需要在 Zustand store 内部使用，或者配合 updateTargetGroup 使用
 * @param group 要更新的组对象
 * @returns 新的状态值
 */
export function calculateGroupStatus(
  group: ChatGroup,
): "normal" | "error" | "pending" {
  // 优先级：error > pending > normal
  if (group.errorCount > 0) {
    return "error";
  } else if (group.pendingCount > 0) {
    return "pending";
  } else {
    return "normal";
  }
}

/**
 * 解析组内会话消息ID
 * 使用正则表达式提取batchId和messageId
 * @param id 消息ID字符串
 * @returns GroupMessageId对象，包含解析结果和有效性标志
 */
export function parseGroupMessageId(id: string): GroupMessageId {
  // 正则表达式：匹配12位batchId_21位messageId的格式
  // ^ 开始
  // ([A-Za-z0-9_-]{12}) 捕获12位的batchId，包含字母、数字、下划线、连字符
  // _ 下划线分隔符
  // ([A-Za-z0-9_-]{21}) 捕获21位的messageId，包含字母、数字、下划线、连字符
  // $ 结束
  const groupMessageIdRegex = /^([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{21})$/;

  const match = id.match(groupMessageIdRegex);

  if (match) {
    return {
      batchId: match[1],
      messageId: match[2],
      isValid: true,
    };
  }

  // 如果不是组内会话格式，返回无效结果
  return {
    batchId: "",
    messageId: "",
    isValid: false,
  };
}

/**
 * 组内合并复制工具函数，供 onMergeCopy 直接调用
 * 使用 p-limit 控制并发，提升性能与稳定性
 * @param format 输出格式：'text' 为文本格式，'json' 为 JSON 格式
 */
export async function handleMergeCopy(
  msg: ChatMessage,
  session: any,
  chatStore: any,
  format: "text" | "json" = "text",
) {
  if (!session.groupId) return;
  const parsed = parseGroupMessageId(msg.id);
  if (!parsed.isValid) return;
  const batchId = parsed.batchId;
  const group = chatStore.groups.find(
    (g: ChatGroup) => g.id === session.groupId,
  );
  if (!group) return;

  // p-limit 控制并发，推荐并发数 8
  const limit = pLimit(8);
  const contents: Array<{
    sourceName: string;
    content: string;
    sessionId: string;
  }> = (
    await Promise.all(
      group.sessionIds.map((sid: string, index: number) =>
        limit(async () => {
          const messages = await messageStorage.get(sid);
          const target = messages.find((m: any) => {
            const p = parseGroupMessageId(m.id);
            return p.isValid && p.batchId === batchId && m.role === "assistant";
          });
          if (target) {
            let content = "";
            if (typeof target.content === "string") content = target.content;
            else if (Array.isArray(target.content))
              content = target.content.map((c: any) => c.text || "").join("\n");

            // 跳过空内容
            if (!content || content.trim().length === 0) {
              return null;
            }

            // 查找 session.sourceName
            const sessionObj =
              chatStore.groupSessions?.[sid] ||
              chatStore.sessions?.find((s: any) => s.id === sid);
            const sourceName = sessionObj?.sourceName || "";

            return {
              sourceName,
              content,
              sessionId: sid,
            };
          }
          return null;
        }),
      ),
    )
  ).filter(Boolean) as Array<{
    sourceName: string;
    content: string;
    sessionId: string;
  }>;

  if (contents.length === 0) return;

  if (format === "json") {
    // JSON 格式：构建对象，键为 sourceName（无则使用 sessionId），值为内容
    const jsonObj: Record<string, string> = {};
    const sourceNameCount: Record<string, number> = {};

    contents.forEach(({ sourceName, content, sessionId }) => {
      // 生成键名：优先使用 sourceName，如果为空则使用 sessionId
      let key = sourceName || `session_${sessionId}`;

      // 处理重复的 sourceName：添加序号后缀
      if (sourceName) {
        // 如果这个 key 已经存在于 jsonObj 中，说明是重复的，需要添加序号
        if (jsonObj[key] !== undefined) {
          // 初始化计数器（如果还没有）
          if (sourceNameCount[key] === undefined) {
            sourceNameCount[key] = 1;
          } else {
            sourceNameCount[key]++;
          }
          key = `${sourceName}_${sourceNameCount[key]}`;
        }
      }

      jsonObj[key] = content;
    });

    // 使用 JSON.stringify 格式化，自动处理转义
    const jsonString = JSON.stringify(jsonObj, null, 2);
    copyToClipboard(jsonString);
  } else {
    // 文本格式：保持原有逻辑
    const textContents = contents.map(({ sourceName, content }) => {
      const prefix = sourceName ? `# ${sourceName}\n\n` : "";
      return prefix + content;
    });
    copyToClipboard(textContents.join("\n\n---\n\n"));
  }
}

/**
 * 比较两个消息的内容是否完全一致（包括文本和图像）
 * @param message1 第一个消息
 * @param message2 第二个消息
 * @returns 是否完全一致
 */
export function areMessagesContentEqual(
  message1: ChatMessage,
  message2: ChatMessage,
): boolean {
  // 比较文本内容
  const text1 = getMessageTextContent(message1);
  const text2 = getMessageTextContent(message2);
  if (text1 !== text2) {
    return false;
  }

  // 比较图像内容
  const images1 = getMessageImages(message1);
  const images2 = getMessageImages(message2);

  // 图像数量不一致
  if (images1.length !== images2.length) {
    return false;
  }

  // 图像URL不一致（顺序敏感）
  for (let i = 0; i < images1.length; i++) {
    if (images1[i] !== images2[i]) {
      return false;
    }
  }

  return true;
}

/**
 * 检查模型回复是否有效（非空且无错误）
 * @param message 模型消息
 * @returns 是否有效
 */
export function isModelReplyValid(message: ChatMessage): boolean {
  // 必须是模型消息
  if (message.role !== "assistant") {
    return false;
  }

  // 检查是否有错误标记
  if (message.isError === true) {
    return false;
  }

  // 检查内容是否为空
  const textContent = getMessageTextContent(message);
  if (!textContent || textContent.trim().length === 0) {
    return false;
  }

  // 检查是否还在流式传输中（未完成的消息视为无效）
  if (message.streaming === true) {
    return false;
  }

  return true;
}

/**
 * 检查目标会话是否已成功应用相同批次的消息
 * @param targetSession 目标会话
 * @param batchId 批次ID
 * @param sourceUserMessage 源用户消息（用于内容比较）
 * @returns 检查结果
 */
export function checkBatchAlreadyApplied(
  targetSession: any,
  batchId: string,
  sourceUserMessage: ChatMessage,
): {
  alreadyApplied: boolean;
  reason?: string;
  existingUserMessage?: ChatMessage;
  existingModelMessage?: ChatMessage;
} {
  // 查找相同 batchId 的用户消息
  const existingUserMsgIndex = targetSession.messages.findIndex(
    (m: ChatMessage) => {
      const parsed = parseGroupMessageId(m.id);
      return parsed.isValid && parsed.batchId === batchId && m.role === "user";
    },
  );

  // 没有找到相同 batchId 的用户消息，需要应用
  if (existingUserMsgIndex === -1) {
    return {
      alreadyApplied: false,
      reason: "未找到相同batchId的用户消息",
    };
  }

  const existingUserMessage = targetSession.messages[existingUserMsgIndex];

  // 检查用户消息内容是否一致
  if (!areMessagesContentEqual(sourceUserMessage, existingUserMessage)) {
    return {
      alreadyApplied: false,
      reason: "用户消息内容不一致",
      existingUserMessage,
    };
  }

  // 检查是否有对应的模型回复
  const nextMsgIndex = existingUserMsgIndex + 1;
  if (nextMsgIndex >= targetSession.messages.length) {
    return {
      alreadyApplied: false,
      reason: "缺少模型回复",
      existingUserMessage,
    };
  }

  const existingModelMessage = targetSession.messages[nextMsgIndex];

  // 检查下一个消息是否是模型回复
  if (existingModelMessage.role !== "assistant") {
    return {
      alreadyApplied: false,
      reason: "下一个消息不是模型回复",
      existingUserMessage,
    };
  }

  // 检查模型回复是否有效
  if (!isModelReplyValid(existingModelMessage)) {
    return {
      alreadyApplied: false,
      reason: "模型回复无效（为空、有错误或未完成）",
      existingUserMessage,
      existingModelMessage,
    };
  }

  // 所有检查都通过，已成功应用
  return {
    alreadyApplied: true,
    reason: "已成功应用",
    existingUserMessage,
    existingModelMessage,
  };
}
