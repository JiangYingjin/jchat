import { nanoid } from "nanoid";
import type { ChatGroup } from "../store/chat";
import { createEmptySession } from "./session";
import Locale from "../locales";
import type { ChatMessage } from "../store";
import pLimit from "p-limit";
import { copyToClipboard } from "../utils";
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
 */
export async function handleMergeCopy(
  msg: ChatMessage,
  session: any,
  chatStore: any,
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
  const allContents: string[] = (
    await Promise.all(
      group.sessionIds.map((sid: string) =>
        limit(async () => {
          const messages = await messageStorage.get(sid);
          const target = messages.find((m: any) => {
            const p = parseGroupMessageId(m.id);
            return p.isValid && p.batchId === batchId && m.role === "assistant";
          });
          if (target) {
            if (typeof target.content === "string") return target.content;
            if (Array.isArray(target.content))
              return target.content.map((c: any) => c.text || "").join("\n");
          }
          return null;
        }),
      ),
    )
  ).filter(Boolean) as string[];

  if (allContents.length > 0) {
    copyToClipboard(allContents.join("\n\n---\n\n"));
  }
}
