import { nanoid } from "nanoid";
import type { ChatGroup } from "../store/chat";
import { createEmptySession } from "./session";
import { useChatStore } from "../store/chat";

/**
 * 创建空的组对象
 * 会同时创建一个空的会话并插入到 chatStore.groupSessions 中
 */
export function createEmptyGroup(): ChatGroup {
  const emptySession = createEmptySession();
  const group: ChatGroup = {
    id: nanoid(),
    title: emptySession.title,
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
