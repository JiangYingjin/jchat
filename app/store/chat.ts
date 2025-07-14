import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi, getHeaders } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import { StoreKey } from "../constant";
import Locale from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { chatInputStorage } from "./input";
import { systemMessageStorage } from "./system";
import { messageStorage, type ChatMessage } from "./message";
import { nanoid } from "nanoid";
import {
  createMessage,
  createEmptySession,
  createBranchSession,
  prepareMessagesForApi,
  generateSessionTitle,
  prepareSendMessages,
  insertMessage,
  calculateMoveIndex,
  validateSessionIndex,
  updateSessionStats,
  updateSessionStatsAsync,
} from "../utils/session";
import { calculateGroupStatus } from "../utils/group";
import { parseGroupMessageId } from "../utils/group";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

// 全局 hydration 状态管理
let isHydrated = false;
const hydrationCallbacks: (() => void)[] = [];

export function isStoreHydrated(): boolean {
  return isHydrated;
}

export function onStoreHydrated(callback: () => void): void {
  if (isHydrated) {
    callback();
  } else {
    hydrationCallbacks.push(callback);
  }
}

export interface ChatSession {
  id: string;
  title: string;
  sourceName?: string; // 表示生成该会话的源文件名，可选
  model: string; // 当前会话选择的模型
  messageCount: number; // 消息数量
  status: "normal" | "error" | "pending"; // 会话状态：正常、错误、用户消息结尾
  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  groupId: string | null;
  lastUpdate: number;
  messages: ChatMessage[];
}

export interface ChatGroup {
  id: string;
  title: string;
  sessionIds: string[];
  messageCount: number;
  status: "normal" | "error" | "pending";
  pendingCount: number;
  errorCount: number;
  currentSessionIndex: number;
}

export interface GroupSession {
  [sessionId: string]: ChatSession;
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()] as ChatSession[],
  groups: [] as ChatGroup[], // 组列表
  groupSessions: {} as GroupSession, // 组内会话列表
  currentSessionIndex: 0,
  currentGroupIndex: 0,
  chatListView: "sessions" as "sessions" | "groups",
  chatListGroupView: "groups" as "groups" | "group-sessions",
  models: [] as string[],
  accessCode: "",
};

export const DEFAULT_TITLE = Locale.Session.Title.Default;

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    const methods = {
      // 新增：加载指定会话的消息
      async loadSessionMessages(sessionIndex: number): Promise<void> {
        // 只在客户端环境下执行
        if (typeof window === "undefined") return;

        const sessions = get().sessions;
        const session = sessions[sessionIndex];
        if (!session) return;

        // 如果消息已经加载（非空），则不重复加载
        if (session.messages && session.messages.length > 0) return;

        try {
          // 从 messageStorage 异步加载消息
          const messages = await messageStorage.get(session.id);
          get().updateTargetSession(session, (s) => {
            s.messages = messages;
            updateSessionStats(s); // 先同步更新基础统计信息
          });

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = get().sessions[sessionIndex];
          if (updatedSession) {
            await updateSessionStatsAsync(updatedSession);
            get().updateTargetSession(updatedSession, () => {});
          }
        } catch (error) {
          console.error(
            `[ChatStore] Failed to load messages for session ${session.id}`,
            error,
          );
        }
      },

      // 新增：保存会话消息到独立存储
      async saveSessionMessages(session: ChatSession): Promise<void> {
        try {
          // 对于组内会话，需要从 groupSessions 中获取最新的消息
          let messagesToSave = session.messages;
          if (session.groupId) {
            const currentState = get();
            const groupSession = currentState.groupSessions[session.id];
            if (groupSession && groupSession.messages) {
              messagesToSave = groupSession.messages;
            } else {
              console.warn(
                `[ChatStore] Group session ${session.id} not found in groupSessions or has no messages`,
              );
            }
          }

          await messageStorage.save(session.id, messagesToSave || []);
        } catch (error) {
          console.error(
            `[ChatStore] Failed to save messages for session ${session.id}`,
            error,
          );
        }
      },

      // 新增：更新会话并同步保存消息
      async updateSessionAndSaveMessages(session: ChatSession): Promise<void> {
        updateSessionStats(session); // 先同步更新基础统计信息
        if (session.groupId) {
          get().updateGroupSession(session, () => {});
        } else {
          get().updateTargetSession(session, () => {});
        }
        await get().saveSessionMessages(session);

        // 异步更新包含系统提示词的完整统计信息
        await updateSessionStatsAsync(session);
        if (session.groupId) {
          get().updateGroupSession(session, () => {});
        } else {
          get().updateTargetSession(session, () => {});
        }
      },
      async forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.title = currentSession.title;
        newSession.messages = [...currentSession.messages];
        newSession.model = currentSession.model;
        newSession.isModelManuallySelected =
          currentSession.isModelManuallySelected;

        // 为新会话保存消息到独立存储
        await get().saveSessionMessages(newSession);

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      async clearSessions() {
        // 删除所有会话的消息
        const currentSessions = get().sessions;
        await Promise.all(
          currentSessions.map((session) => messageStorage.delete(session.id)),
        );

        const newSession = createEmptySession();
        // 为新创建的空会话保存（空的）消息
        await get().saveSessionMessages(newSession);

        set(() => ({
          sessions: [newSession],
          currentSessionIndex: 0,
        }));

        // **修复：确保新会话的消息正确加载**
        await get().loadSessionMessages(0);
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
        // 当选择一个新会话时，触发消息加载
        get().loadSessionMessages(index);
      },

      moveSession(from: number, to: number) {
        const oldIndex = get().currentSessionIndex;

        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // calculate new index using utility function
          const newIndex = calculateMoveIndex(from, to, oldIndex);

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });

        // **修复：如果当前会话索引改变了，加载新当前会话的消息**
        const newIndex = calculateMoveIndex(from, to, oldIndex);
        if (newIndex !== oldIndex) {
          get().loadSessionMessages(newIndex);
        }
      },

      // 移动组的位置
      moveGroup(from: number, to: number) {
        const oldIndex = get().currentGroupIndex;

        set((state) => {
          const { groups, currentGroupIndex: oldIndex } = state;

          // move the group
          const newGroups = [...groups];
          const group = newGroups[from];
          newGroups.splice(from, 1);
          newGroups.splice(to, 0, group);

          // calculate new index using utility function
          const newIndex = calculateMoveIndex(from, to, oldIndex);

          return {
            currentGroupIndex: newIndex,
            groups: newGroups,
          };
        });
      },

      async newSession() {
        const session = createEmptySession();

        // 先进行 IndexedDB 健康检查
        const isHealthy = await messageStorage.healthCheck();
        if (!isHealthy) {
          console.error("[ChatStore] IndexedDB 健康检查失败，请重启浏览器重试");
          showToast("存储系统异常，请重启浏览器重试");
          return;
        }

        await get().saveSessionMessages(session);

        set((state) => {
          return {
            currentSessionIndex: 0,
            sessions: [session].concat(state.sessions),
          };
        });

        // 确保新会话的消息正确加载
        await get().loadSessionMessages(0);
      },

      async newGroup(group: ChatGroup) {
        const { groups, groupSessions } = get();

        // 创建组内第一个会话
        const firstSession = createEmptySession();
        firstSession.groupId = group.id;
        firstSession.title = group.title;

        // 保存会话消息
        await get().saveSessionMessages(firstSession);

        // 更新组和组内会话
        set((state) => {
          const updatedGroup = {
            ...group,
            sessionIds: [firstSession.id],
            currentSessionIndex: 0,
            title: firstSession.title,
            messageCount: firstSession.messageCount,
            errorCount: 0,
            pendingCount: 0,
          };

          // 确保组状态与计数保持一致
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          return {
            groups: [updatedGroup, ...state.groups],
            groupSessions: {
              ...state.groupSessions,
              [firstSession.id]: firstSession,
            },
            currentGroupIndex: 0,
          };
        });
      },

      // 新建组内会话
      async newGroupSession() {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          console.warn("[ChatStore] No current group found");
          return;
        }

        // 创建新的组内会话
        const newSession = createEmptySession();
        newSession.groupId = currentGroup.id;
        newSession.title = Locale.Session.Title.DefaultGroup;

        // 保存会话消息
        await get().saveSessionMessages(newSession);

        // 更新组和组内会话
        set((state) => {
          const updatedGroup = {
            ...currentGroup,
            sessionIds: [...currentGroup.sessionIds, newSession.id],
            currentSessionIndex: currentGroup.sessionIds.length,
            title:
              currentGroup.sessionIds.length === 0
                ? newSession.title
                : currentGroup.title,
            messageCount: currentGroup.messageCount + newSession.messageCount,
          };

          // 确保组状态与计数保持一致
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          const newGroups = [...state.groups];
          newGroups[currentGroupIndex] = updatedGroup;

          return {
            groups: newGroups,
            groupSessions: {
              ...state.groupSessions,
              [newSession.id]: newSession,
            },
          };
        });

        // 确保新会话的消息正确加载
        await get().loadGroupSessionMessages(newSession.id);
      },

      // 设置聊天列表模式
      setchatListView(mode: "sessions" | "groups") {
        set({ chatListView: mode });

        // 切换模式后，确保当前会话的消息已加载
        setTimeout(() => {
          const session = get().currentSession();
          if (session && (!session.messages || session.messages.length === 0)) {
            if (session.groupId) {
              // 组内会话：加载组内会话消息
              get().loadGroupSessionMessages(session.id);
            } else {
              // 普通会话：加载普通会话消息
              get().loadSessionMessages(get().currentSessionIndex);
            }
          }
        }, 0);
      },

      // 设置组内视图模式
      setchatListGroupView(mode: "groups" | "group-sessions") {
        set({ chatListGroupView: mode });

        // 切换组内视图后，确保当前会话的消息已加载
        setTimeout(() => {
          const session = get().currentSession();
          if (
            session &&
            session.groupId &&
            (!session.messages || session.messages.length === 0)
          ) {
            get().loadGroupSessionMessages(session.id);
          }
        }, 0);
      },

      // 选择指定的组
      selectGroup(index: number) {
        const { groups, currentGroupIndex, groupSessions } = get();
        const targetGroup = groups[index];

        if (!targetGroup || targetGroup.sessionIds.length === 0) return;

        // 判断是否是第一次点击该组（当前组索引不是这个组）
        if (currentGroupIndex !== index) {
          // 第一次点击：切换到该组并加载第一个会话，但不切换到组内会话视图
          const firstSessionId = targetGroup.sessionIds[0];
          const firstSession = groupSessions[firstSessionId];

          if (firstSession) {
            // 切换到该组，保持在组列表视图
            set({
              currentGroupIndex: index,
              chatListGroupView: "groups", // 确保保持在组列表视图
            });

            // 加载第一个会话的消息（如果还没加载）
            if (!firstSession.messages || firstSession.messages.length === 0) {
              get().loadGroupSessionMessages(firstSessionId);
            }
          }
        } else {
          // 第二次点击：切换到组内会话视图
          set({
            chatListGroupView: "group-sessions",
          });
        }
      },

      // 选择组内的指定会话
      selectGroupSession(
        sessionIndex: number,
        switchToGroupSessionsView: boolean = false,
      ) {
        const { groups, currentGroupIndex } = get();
        const currentGroup = groups[currentGroupIndex];
        if (!currentGroup) {
          console.warn(`[ChatStore] No current group found`);
          return;
        }

        // 更新组内的当前会话索引
        set((state) => {
          const newGroups = [...state.groups];
          newGroups[currentGroupIndex] = {
            ...currentGroup,
            currentSessionIndex: sessionIndex,
          };
          return {
            groups: newGroups,
            ...(switchToGroupSessionsView
              ? { chatListGroupView: "group-sessions" }
              : {}),
          };
        });

        // 加载组内会话的消息
        const sessionId = currentGroup.sessionIds[sessionIndex];
        const session = get().groupSessions[sessionId];
        if (session && (!session.messages || session.messages.length === 0)) {
          // 只在消息未加载时才加载
          get().loadGroupSessionMessages(sessionId);
        } else if (!session) {
          console.warn(
            `[ChatStore] Group session ${sessionId} not found in groupSessions`,
          );
        }
      },

      // 新增：加载组内会话的消息
      async loadGroupSessionMessages(sessionId: string): Promise<void> {
        if (typeof window === "undefined") return;

        const session = get().groupSessions[sessionId];
        if (!session) {
          console.warn(`[ChatStore] Group session ${sessionId} not found`);
          return;
        }

        // 如果消息已经加载（非空），则不重复加载
        if (session.messages && session.messages.length > 0) {
          return;
        }

        try {
          // 从 messageStorage 异步加载消息
          const messages = await messageStorage.get(sessionId);

          set((state) => {
            const updatedSession = {
              ...session,
              messages: messages,
              messageCount: messages.length, // 先设置基础消息数量
            };

            // 如果是第一个会话，同时更新组的 messageCount
            let newGroups = state.groups;
            if (session.groupId) {
              const groupIndex = state.groups.findIndex(
                (g) => g.id === session.groupId,
              );
              if (groupIndex !== -1) {
                const group = state.groups[groupIndex];
                const firstSessionId = group.sessionIds[0];
                if (firstSessionId === sessionId) {
                  newGroups = [...state.groups];
                  newGroups[groupIndex] = {
                    ...group,
                    messageCount: messages.length, // 先设置基础消息数量
                    // 确保组状态与计数保持一致
                    status: calculateGroupStatus(group),
                  };
                }
              }
            }

            return {
              groupSessions: {
                ...state.groupSessions,
                [sessionId]: updatedSession,
              },
              groups: newGroups,
            };
          });

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = get().groupSessions[sessionId];
          if (updatedSession) {
            await updateSessionStatsAsync(updatedSession);

            // 更新组内会话状态
            set((state) => {
              const newGroupSessions = {
                ...state.groupSessions,
                [sessionId]: updatedSession,
              };

              // 如果是第一个会话，同时更新组的 messageCount
              let newGroups = state.groups;
              if (updatedSession.groupId) {
                const groupIndex = state.groups.findIndex(
                  (g) => g.id === updatedSession.groupId,
                );
                if (groupIndex !== -1) {
                  const group = state.groups[groupIndex];
                  const firstSessionId = group.sessionIds[0];
                  if (firstSessionId === sessionId) {
                    newGroups = [...state.groups];
                    newGroups[groupIndex] = {
                      ...group,
                      messageCount: updatedSession.messageCount, // 使用更新后的消息数量
                      status: calculateGroupStatus(group),
                    };
                  }
                }
              }

              return {
                groupSessions: newGroupSessions,
                groups: newGroups,
              };
            });
          }
        } catch (error) {
          console.error(
            `[ChatStore] Failed to load messages for group session ${sessionId}`,
            error,
          );
        }
      },

      // 删除组内会话
      async deleteGroupSession(sessionId: string): Promise<void> {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          console.warn(`[ChatStore] No current group found`);
          return;
        }

        const sessionIndex = currentGroup.sessionIds.indexOf(sessionId);
        if (sessionIndex === -1) {
          console.warn(
            `[ChatStore] Session ${sessionId} not found in current group`,
          );
          return;
        }

        const deletedSession = groupSessions[sessionId];
        if (!deletedSession) {
          console.warn(
            `[ChatStore] Group session ${sessionId} not found in groupSessions`,
          );
          return;
        }

        // 检查是否是组内唯一的会话
        const isLastSession = currentGroup.sessionIds.length === 1;

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          // 确保包含所有必要的状态字段
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          chatListView: get().chatListView,
          models: get().models,
          accessCode: get().accessCode,
        };

        // 准备新的会话ID列表和状态更新
        let newSessionIds = [...currentGroup.sessionIds];
        let newCurrentSessionIndex = currentGroup.currentSessionIndex;
        let newGroupSessions = { ...groupSessions };
        let newSessionToAdd: ChatSession | null = null;

        // 如果删除的是最后一个会话，先创建新会话
        if (isLastSession) {
          console.log(
            `[ChatStore] Last session deleted, creating new empty session`,
          );

          // 创建新的组内会话
          newSessionToAdd = createEmptySession();
          newSessionToAdd.groupId = currentGroup.id;
          newSessionToAdd.title = Locale.Session.Title.DefaultGroup;

          // 保存会话消息
          await get().saveSessionMessages(newSessionToAdd);

          // 更新会话ID列表和索引
          newSessionIds = [newSessionToAdd.id];
          newCurrentSessionIndex = 0;
          newGroupSessions[newSessionToAdd.id] = newSessionToAdd;
        } else {
          // 删除指定会话
          newSessionIds.splice(sessionIndex, 1);

          // 计算删除后的当前会话索引
          if (sessionIndex < currentGroup.currentSessionIndex) {
            newCurrentSessionIndex--;
          } else if (sessionIndex === currentGroup.currentSessionIndex) {
            // 如果删除的是当前会话，选择前一个会话，如果没有则选择下一个
            newCurrentSessionIndex = Math.max(0, sessionIndex - 1);
          }
        }

        // 从 groupSessions 中删除被删除的会话
        delete newGroupSessions[sessionId];

        // 立即更新UI状态（一次性完成删除和添加新会话）
        set((state) => {
          const newGroups = [...state.groups];

          // 更新组信息
          let updatedGroup = {
            ...currentGroup,
            sessionIds: newSessionIds,
            currentSessionIndex: newCurrentSessionIndex,
          };

          // 更新父组的状态计数：减少被删除会话的状态计数
          if (deletedSession.status === "error") {
            updatedGroup.errorCount = Math.max(0, updatedGroup.errorCount - 1);
          } else if (deletedSession.status === "pending") {
            updatedGroup.pendingCount = Math.max(
              0,
              updatedGroup.pendingCount - 1,
            );
          }

          // 如果是删除最后一个会话并创建新会话，重置计数
          if (isLastSession && newSessionToAdd) {
            updatedGroup.title = newSessionToAdd.title;
            updatedGroup.messageCount = newSessionToAdd.messageCount;
            updatedGroup.errorCount = 0;
            updatedGroup.pendingCount = 0;
          } else if (sessionIndex === 0 && newSessionIds.length > 0) {
            // 删除的是第一个会话，更新组的标题和 messageCount 为新的第一个会话的标题和 messageCount
            const newFirstSessionId = newSessionIds[0];
            const newFirstSession = newGroupSessions[newFirstSessionId];
            if (newFirstSession) {
              updatedGroup.title = newFirstSession.title;
              updatedGroup.messageCount = newFirstSession.messageCount;
            }
          }

          // 重新计算组状态
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          newGroups[currentGroupIndex] = updatedGroup;

          return {
            groups: newGroups,
            groupSessions: newGroupSessions,
          };
        });

        // **在切换到新会话后，立即加载其消息**
        if (isLastSession && newSessionToAdd) {
          // 如果是新创建的会话，加载其消息
          await get().loadGroupSessionMessages(newSessionToAdd.id);
          console.log(
            `[ChatStore] New empty session created: ${newSessionToAdd.id}`,
          );
        } else if (newSessionIds[newCurrentSessionIndex]) {
          // 如果是切换到现有会话，加载其消息
          await get().loadGroupSessionMessages(
            newSessionIds[newCurrentSessionIndex],
          );
        }

        console.log(`[ChatStore] Group session ${sessionId} removed from UI`);

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.delete(sessionId),
              chatInputStorage.delete(sessionId),
              systemMessageStorage.delete(sessionId),
            ]);
            console.log(
              `[ChatStore] Group session ${sessionId} data deleted permanently`,
            );
          } catch (error) {
            console.error(
              `[ChatStore] Failed to delete group session ${sessionId} data:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreGroupSession = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复组内会话状态
          set(() => restoreState);

          // 确保恢复的会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            await get().loadGroupSessionMessages(sessionId);
          }, 0);

          console.log(`[ChatStore] Group session ${sessionId} deletion undone`);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        const toastMessage = isLastSession
          ? Locale.Chat.DeleteLastGroupSessionToast
          : Locale.Chat.DeleteSessionToast;

        showToast(
          toastMessage,
          {
            text: Locale.Chat.Revert,
            onClick: restoreGroupSession,
          },
          8000,
        );
      },

      // 删除整个组及其所有会话
      async deleteGroup(groupId: string): Promise<void> {
        const { groups, currentGroupIndex, groupSessions } = get();
        const targetGroup = groups.find((g) => g.id === groupId);

        if (!targetGroup) {
          console.warn(`[ChatStore] Group ${groupId} not found`);
          return;
        }

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          chatListView: get().chatListView,
          // 确保包含所有必要的状态字段
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          models: get().models,
          accessCode: get().accessCode,
        };

        // 获取组内所有会话ID
        const sessionIds = [...targetGroup.sessionIds];

        // 计算删除后的当前组索引
        const groupIndex = groups.findIndex((g) => g.id === groupId);
        let newCurrentGroupIndex = currentGroupIndex;
        if (groupIndex < currentGroupIndex) {
          newCurrentGroupIndex--;
        } else if (groupIndex === currentGroupIndex) {
          // 如果删除的是当前组，选择前一个组，如果没有则选择下一个
          newCurrentGroupIndex = Math.max(0, groupIndex - 1);
        }

        // 立即更新UI状态（从组列表中移除）
        set((state) => {
          const newGroups = state.groups.filter((g) => g.id !== groupId);
          const newGroupSessions = { ...state.groupSessions };

          // 从 groupSessions 中移除所有相关会话
          sessionIds.forEach((sessionId) => {
            delete newGroupSessions[sessionId];
          });

          return {
            groups: newGroups,
            groupSessions: newGroupSessions,
            currentGroupIndex: newCurrentGroupIndex,
            // 如果删除的是当前组，切换到组列表视图
            ...(groupIndex === currentGroupIndex
              ? { chatListView: "groups" as const }
              : {}),
          };
        });

        console.log(
          `[ChatStore] Group ${groupId} and all its sessions removed from UI`,
        );

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            // 删除所有会话的相关数据
            const deletePromises = sessionIds.map(async (sessionId) => {
              await Promise.all([
                messageStorage.delete(sessionId),
                chatInputStorage.delete(sessionId),
                systemMessageStorage.delete(sessionId),
              ]);
            });

            await Promise.all(deletePromises);
            console.log(
              `[ChatStore] Group ${groupId} and all its sessions data deleted permanently`,
            );
          } catch (error) {
            console.error(
              `[ChatStore] Failed to delete group ${groupId} data:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreGroup = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复组状态
          set(() => restoreState);

          // 确保恢复的组内会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            for (const sessionId of sessionIds) {
              await get().loadGroupSessionMessages(sessionId);
            }
          }, 0);

          console.log(`[ChatStore] Group ${groupId} deletion undone`);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteGroupToast,
          {
            text: Locale.Chat.Revert,
            onClick: restoreGroup,
          },
          8000,
        );
      },

      // 分支会话：创建一个包含指定消息历史的新会话
      async branchSession(
        originalSession: ChatSession,
        messagesToCopy: ChatMessage[],
        systemMessageData: any,
        branchTopic: string,
      ) {
        const newSession = createBranchSession(
          originalSession,
          messagesToCopy,
          branchTopic,
        );

        // 为新分支会话保存消息
        await get().saveSessionMessages(newSession);

        // **修复：在状态更新前先保存系统提示词**
        if (
          systemMessageData &&
          (systemMessageData.text.trim() || systemMessageData.images.length > 0)
        ) {
          try {
            const success = await systemMessageStorage.save(
              newSession.id,
              systemMessageData,
            );
            if (!success) {
              console.error("保存系统提示词到新分支会话失败");
            }
          } catch (error) {
            console.error("保存系统提示词到新分支会话失败:", error);
          }
        }

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionIndex: 0, // 切换到新创建的分支会话
        }));

        // 确保新会话的消息已正确加载（虽然是新创建的，但为了保险起见）
        await get().loadSessionMessages(0);

        return newSession;
      },

      // 从指定消息创建分支会话
      async branchSessionFrom(message: ChatMessage, messageIndex: number) {
        const session = get().currentSession();
        if (!session) {
          throw new Error("当前会话不存在");
        }

        // 组内会话不支持分支功能
        if (session.groupId) {
          throw new Error("组内会话不支持分支功能");
        }

        try {
          // 复制会话标题并标注分支
          const originalTitle = session.title || DEFAULT_TITLE;

          // 生成分支标题，支持递增数字
          const getBranchTitle = (title: string): string => {
            // 匹配 (分支) 或 (分支数字) 的正则表达式
            const branchRegex = /\(分支(\d*)\)$/;
            const match = title.match(branchRegex);

            if (!match) {
              // 没有匹配到分支标记，直接添加 (分支)
              return `${title} (分支)`;
            } else {
              // 匹配到分支标记，递增数字
              const currentNumber = match[1] ? parseInt(match[1]) : 1;
              const nextNumber = currentNumber + 1;
              const baseTitle = title.replace(branchRegex, "");
              return `${baseTitle} (分支${nextNumber})`;
            }
          };

          const branchTitle = getBranchTitle(originalTitle);

          // 复制系统提示词
          const systemMessageData = await systemMessageStorage.get(session.id);

          // 获取完整的消息历史（不受分页限制）
          const fullMessages = session.messages.filter(
            (m) => m.role !== "system",
          );

          // 通过message.id在完整历史中找到真实位置（不依赖分页后的索引）
          const realIndex = fullMessages.findIndex((m) => m.id === message.id);
          if (realIndex === -1) {
            throw new Error("无法在完整历史中找到目标消息");
          }

          // 复制消息历史（包含该消息及之前的所有消息）
          const originalMessages = fullMessages.slice(0, realIndex + 1);

          // 为每条消息重新生成ID，确保唯一性，保持其他属性不变
          const messagesToCopy = originalMessages.map((message) => {
            return {
              ...message,
              id: nanoid(), // 使用普通nanoid格式
            };
          });

          // 使用现有的branchSession方法，系统提示词会在内部自动保存
          const newSession = await get().branchSession(
            session,
            messagesToCopy,
            systemMessageData,
            branchTitle,
          );

          return newSession;
        } catch (error) {
          console.error("分支会话失败:", error);
          throw error;
        }
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      async deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          // 确保包含所有必要的状态字段
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          chatListView: get().chatListView,
          models: get().models,
          accessCode: get().accessCode,
        };
        const deletedSessionIndex = index;

        // 准备新的状态
        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          const newSession = createEmptySession();
          sessions.push(newSession);
          // 为新创建的空会话保存（空的）消息
          await get().saveSessionMessages(newSession);
        }

        // 立即更新UI状态（从sessions数组中移除）
        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        // **修复：在切换到新session后，立即加载其消息**
        await get().loadSessionMessages(nextIndex);

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.delete(deletedSession.id),
              chatInputStorage.delete(deletedSession.id),
              systemMessageStorage.delete(deletedSession.id),
            ]);
            console.log(
              `[DeleteSession] 已删除会话 ${deletedSession.id} 的所有数据`,
            );
          } catch (error) {
            console.error(
              `[DeleteSession] 删除会话 ${deletedSession.id} 的数据失败:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreSession = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复会话状态
          set(() => restoreState);

          // 确保恢复的会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            await get().loadSessionMessages(deletedSessionIndex);
          }, 0);

          console.log(`[DeleteSession] 已撤销删除会话 ${deletedSession.id}`);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteSessionToast,
          {
            text: Locale.Chat.Revert,
            onClick: restoreSession,
          },
          8000,
        );
      },

      currentSession() {
        const {
          chatListView: chatListView,
          chatListGroupView,
          groups,
          currentGroupIndex,
          groupSessions,
          sessions,
          currentSessionIndex,
        } = get();

        // 普通会话模式：返回当前普通会话
        if (chatListView === "sessions") {
          let index = currentSessionIndex;
          const validIndex = validateSessionIndex(index, sessions.length);
          if (validIndex !== index) {
            set(() => ({ currentSessionIndex: validIndex }));
            index = validIndex;
            // **修复：如果索引被纠正，异步加载新当前会话的消息**
            get().loadSessionMessages(validIndex);
          }
          const session = sessions[index];
          return session;
        }

        // 组会话模式：根据组内视图决定返回哪个会话
        if (chatListView === "groups") {
          // 组内会话模式：返回当前组的当前会话
          if (chatListGroupView === "group-sessions") {
            const currentGroup = groups[currentGroupIndex];
            if (currentGroup && currentGroup.sessionIds.length > 0) {
              const currentSessionId =
                currentGroup.sessionIds[currentGroup.currentSessionIndex];
              const session = groupSessions[currentSessionId];
              if (session) {
                // 移除直接调用loadGroupSessionMessages，避免无限循环
                // 消息加载应该在组件层面处理
                return session;
              } else {
                console.warn(
                  `[ChatStore] Group session ${currentSessionId} not found in groupSessions`,
                );
              }
            }
            // 如果组内会话模式但没有找到会话，回退到组列表模式
            console.log(
              `[ChatStore] No group session found, falling back to groups view`,
            );
            set({ chatListGroupView: "groups" });
          }

          // 组列表模式：返回当前组的第一个会话
          if (chatListGroupView === "groups") {
            const currentGroup = groups[currentGroupIndex];
            if (currentGroup && currentGroup.sessionIds.length > 0) {
              const firstSessionId = currentGroup.sessionIds[0];
              const session = groupSessions[firstSessionId];
              if (session) {
                // 移除直接调用loadGroupSessionMessages，避免无限循环
                // 消息加载应该在组件层面处理
                return session;
              } else {
                console.warn(
                  `[ChatStore] Group session ${firstSessionId} not found in groupSessions`,
                );
              }
            }
          }
        }

        // 兜底：返回当前普通会话
        let index = currentSessionIndex;
        const validIndex = validateSessionIndex(index, sessions.length);
        if (validIndex !== index) {
          set(() => ({ currentSessionIndex: validIndex }));
          index = validIndex;
          // **修复：如果索引被纠正，异步加载新当前会话的消息**
          get().loadSessionMessages(validIndex);
        }

        const fallbackSession = sessions[index];
        return fallbackSession;
      },

      onNewMessage(
        message: ChatMessage,
        targetSession: ChatSession,
        usage?: any,
      ) {
        if (targetSession.groupId) {
          // 用 store 最新对象
          const latest = get().groupSessions[targetSession.id] || targetSession;
          get().updateGroupSession(latest, (session) => {
            session.lastUpdate = Date.now();
          });
          get().generateSessionTitle(false, latest);
        } else {
          const latest =
            get().sessions.find((s) => s.id === targetSession.id) ||
            targetSession;
          get().updateTargetSession(latest, (session) => {
            session.lastUpdate = Date.now();
          });
          get().generateSessionTitle(false, latest);
        }
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
        targetSessionId?: string, // 新增：指定目标会话ID
        batchId?: string, // 新增：指定batchId，用于批量应用
        modelBatchId?: string, // 新增：指定模型消息的batchId，用于批量应用时保持模型消息batch id一致
      ) {
        // 根据 targetSessionId 获取目标会话，如果没有指定则使用当前会话
        let session: ChatSession;
        if (targetSessionId) {
          // 查找指定的会话
          const groupSession = get().groupSessions[targetSessionId];
          const normalSession = get().sessions.find(
            (s) => s.id === targetSessionId,
          );
          session = groupSession || normalSession || get().currentSession();
        } else {
          session = get().currentSession();
        }

        // 确保消息已加载
        if (!session.messages || session.messages.length === 0) {
          if (session.groupId) {
            await get().loadGroupSessionMessages(session.id);
          } else {
            await get().loadSessionMessages(get().currentSessionIndex);
          }
        }

        let mContent: string | MultimodalContent[] = content;

        if (attachImages && attachImages.length > 0) {
          mContent = [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        }

        // 为组内会话生成batchId，支持分别指定用户消息和模型消息的batchId
        let userBatchId: string | undefined;
        let finalModelBatchId: string | undefined;

        if (session.groupId) {
          // 用户消息使用传入的batchId或生成新的
          userBatchId = batchId || nanoid(12);
          // 模型消息使用传入的modelBatchId或生成新的
          finalModelBatchId = modelBatchId || nanoid(12);
        }

        let userMessage: ChatMessage = createMessage(
          {
            role: "user",
            content: mContent,
          },
          userBatchId,
        );

        const modelMessage = createMessage(
          {
            role: "assistant",
            content: "",
            streaming: true,
            model: session.model,
          },
          finalModelBatchId,
        );

        // get recent messages for the target session
        let recentMessages: ChatMessage[];
        if (targetSessionId && targetSessionId !== get().currentSession().id) {
          // 如果指定了目标会话且不是当前会话，使用目标会话的消息（包含系统提示词）
          recentMessages = await prepareMessagesForApi(
            session,
            systemMessageStorage,
          );
        } else {
          // 否则使用当前会话的消息（保持原有逻辑）
          recentMessages = await get().prepareMessagesForApi();
        }

        let sendMessages = prepareSendMessages(
          recentMessages,
          userMessage,
          messageIdx,
        );

        const messageIndex = session.messages.length + 1;

        // 始终获取最新的 session 对象
        let latestSession: ChatSession | undefined;
        if (session.groupId) {
          latestSession = get().groupSessions[session.id];
        } else {
          latestSession = get().sessions.find((s) => s.id === session.id);
        }
        if (latestSession) {
          session = latestSession;
        }

        // 去重并插入用户消息
        if (session.groupId && userBatchId) {
          session.messages = ensureUniqueUserMessage(
            session.messages,
            userMessage,
            userBatchId,
          );
        }

        if (session.groupId) {
          get().updateGroupSession(session, (session) => {
            const savedUserMessage = {
              ...userMessage,
              content: mContent,
            };
            session.messages = insertMessage(
              session.messages,
              savedUserMessage,
              modelMessage,
              messageIdx,
            );
            updateSessionStats(session); // 先同步更新基础统计信息
          });
        } else {
          get().updateTargetSession(session, (session) => {
            const savedUserMessage = {
              ...userMessage,
              content: mContent,
            };
            session.messages = insertMessage(
              session.messages,
              savedUserMessage,
              modelMessage,
              messageIdx,
            );
            updateSessionStats(session); // 先同步更新基础统计信息
          });
        }

        // 立即保存消息到独立存储
        await get().saveSessionMessages(session);

        // 异步更新包含系统提示词的完整统计信息
        const currentSession = get().currentSession();
        await updateSessionStatsAsync(currentSession);

        // 根据会话类型更新状态
        if (currentSession.groupId) {
          get().updateGroupSession(currentSession, () => {});
        } else {
          get().updateTargetSession(currentSession, () => {});
        }

        const api: ClientApi = getClientApi();
        // make request
        api.llm.chat({
          messages: sendMessages,
          config: { model: session.model, stream: true },
          onUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.content = message;
            }
            if (session.groupId) {
              get().updateGroupSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            }
            // 异步保存消息更新 - 使用目标会话
            get().saveSessionMessages(session);

            // 异步更新包含系统提示词的完整统计信息
            updateSessionStatsAsync(session).then(() => {
              if (session.groupId) {
                get().updateGroupSession(session, () => {});
              } else {
                get().updateTargetSession(session, () => {});
              }
            });
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }
            if (session.groupId) {
              get().updateGroupSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            }
            // 异步保存消息更新 - 使用目标会话
            get().saveSessionMessages(session);

            // 异步更新包含系统提示词的完整统计信息
            updateSessionStatsAsync(session).then(() => {
              if (session.groupId) {
                get().updateGroupSession(session, () => {});
              } else {
                get().updateTargetSession(session, () => {});
              }
            });
          },
          onFinish(message, responseRes, usage) {
            modelMessage.streaming = false;
            if (message) {
              modelMessage.content = message;
              modelMessage.date = new Date().toLocaleString();
              if (responseRes && responseRes.status !== 200) {
                modelMessage.isError = true;

                // 如果返回 401 未授权，清空 accessCode 并跳转到 auth 页面
                if (responseRes.status === 401) {
                  // 需要通过某种方式获取 navigate 函数
                  // 这里我们先在 window 对象上设置一个全局的处理函数
                  if (
                    typeof window !== "undefined" &&
                    (window as any).__handleUnauthorized
                  ) {
                    (window as any).__handleUnauthorized();
                  }
                }
              }

              get().onNewMessage(modelMessage, session, usage);
            }
            // 保存最终消息状态 - 使用目标会话
            get().saveSessionMessages(session);
            ChatControllerPool.remove(session.id, modelMessage.id);
          },

          onError(error) {
            const isAborted = error.message?.includes?.("aborted");
            modelMessage.content +=
              "\n\n" +
              prettyObject({
                error: true,
                message: error.message,
              });
            modelMessage.streaming = false;
            userMessage.isError = !isAborted;
            modelMessage.isError = !isAborted;
            if (session.groupId) {
              get().updateGroupSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session); // 先同步更新基础统计信息
              });
            }
            // 保存错误状态的消息 - 使用目标会话
            get().saveSessionMessages(session);

            // 异步更新包含系统提示词的完整统计信息
            updateSessionStatsAsync(session).then(() => {
              if (session.groupId) {
                get().updateGroupSession(session, () => {});
              } else {
                get().updateTargetSession(session, () => {});
              }
            });

            ChatControllerPool.remove(
              session.id,
              modelMessage.id ?? messageIndex,
            );

            console.error("[Chat] failed ", error);
          },
          onController(controller) {
            // collect controller for stop/retry
            ChatControllerPool.addController(
              session.id,
              modelMessage.id ?? messageIndex,
              controller,
            );
          },
        });
      },

      async prepareMessagesForApi() {
        const session = get().currentSession();

        // **核心改动：如果消息未加载，先加载它们**
        if (session && (!session.messages || session.messages.length === 0)) {
          if (session.groupId) {
            await get().loadGroupSessionMessages(session.id);
          } else {
            await get().loadSessionMessages(get().currentSessionIndex);
          }
        }
        // get() 会获取最新状态，此时 messages 应该已加载
        const finalSession = get().currentSession();

        return await prepareMessagesForApi(finalSession, systemMessageStorage);
      },

      async updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        set((state) => {
          const sessions = [...state.sessions];
          const session = sessions[sessionIndex];
          if (!session) return {};
          const messages = session.messages;
          updater(messages?.[messageIndex]);
          updateSessionStats(session); // 先同步更新基础统计信息
          return { sessions };
        });
        // 保存最新
        const session = get().sessions[sessionIndex];
        if (session) {
          await get().saveSessionMessages(session);

          // 异步更新包含系统提示词的完整统计信息
          await updateSessionStatsAsync(session);
          get().updateTargetSession(session, () => {});
        }
      },

      async resetSession(session: ChatSession) {
        if (session.groupId) {
          get().updateGroupSession(session, (session) => {
            session.messages = [];
            updateSessionStats(session); // 先同步更新基础统计信息
          });
        } else {
          get().updateTargetSession(session, (session) => {
            session.messages = [];
            updateSessionStats(session); // 先同步更新基础统计信息
          });
        }
        await get().saveSessionMessages(session);

        // 异步更新包含系统提示词的完整统计信息
        await updateSessionStatsAsync(session);
        if (session.groupId) {
          get().updateGroupSession(session, () => {});
        } else {
          get().updateTargetSession(session, () => {});
        }
      },

      async generateSessionTitle(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        await generateSessionTitle(targetSession, refreshTitle, (newTopic) => {
          // 根据会话类型选择更新方法
          if (targetSession.groupId) {
            get().updateGroupSession(targetSession, (session) => {
              session.title = newTopic;
            });
          } else {
            get().updateTargetSession(targetSession, (session) => {
              session.title = newTopic;
            });
          }
        });
      },

      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          const index = state.sessions.findIndex(
            (s) => s.id === targetSession.id,
          );
          if (index < 0) return {};
          // 以 store 里的最新对象为基础
          const updatedSession = { ...state.sessions[index] };
          updater(updatedSession);
          const newSessions = [...state.sessions];
          newSessions[index] = updatedSession;
          return { sessions: newSessions };
        });
      },

      // 更新组内会话并同步组标题和消息数量
      updateGroupSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          // 一定要以 groupSessions 里的最新对象为基础，防止被旧对象覆盖
          const baseSession =
            state.groupSessions[targetSession.id] || targetSession;
          const updatedSession = { ...baseSession };

          // 保存更新前的状态，用于计算状态变化
          const oldStatus = updatedSession.status;

          // 应用更新器
          updater(updatedSession);

          // 如果状态发生了变化，需要更新父组的计数
          const newStatus = updatedSession.status;
          const statusChanged = oldStatus !== newStatus;

          const newGroupSessions = {
            ...state.groupSessions,
            [targetSession.id]: updatedSession,
          };

          // 更新组状态
          let newGroups = state.groups;
          if (targetSession.groupId) {
            const groupIndex = state.groups.findIndex(
              (g) => g.id === targetSession.groupId,
            );
            if (groupIndex !== -1) {
              const group = state.groups[groupIndex];
              const updatedGroup = { ...group };

              // 如果状态发生了变化，安全地更新计数
              if (statusChanged) {
                // 减少旧状态的计数
                if (oldStatus === "error") {
                  updatedGroup.errorCount = Math.max(
                    0,
                    updatedGroup.errorCount - 1,
                  );
                } else if (oldStatus === "pending") {
                  updatedGroup.pendingCount = Math.max(
                    0,
                    updatedGroup.pendingCount - 1,
                  );
                }

                // 增加新状态的计数
                if (newStatus === "error") {
                  updatedGroup.errorCount += 1;
                } else if (newStatus === "pending") {
                  updatedGroup.pendingCount += 1;
                }

                // 重新计算组状态
                updatedGroup.status = calculateGroupStatus(updatedGroup);
              }

              // 如果是第一个会话，同步组标题和消息数量
              const firstSessionId = group.sessionIds[0];
              if (firstSessionId === targetSession.id) {
                updatedGroup.title = updatedSession.title;
                updatedGroup.messageCount = updatedSession.messageCount;
              }

              newGroups = [...state.groups];
              newGroups[groupIndex] = updatedGroup;
            }
          }

          return {
            groupSessions: newGroupSessions,
            groups: newGroups,
          };
        });
      },

      fetchModels() {
        if (fetchState > 0) return;
        fetchState = 1;
        fetch("/api/models", {
          method: "post",
          body: null,
          headers: {
            ...getHeaders(),
          },
        })
          .then((res) => res.json())
          .then((res: any) => {
            console.log("[Config] got config from server", res);
            set(() => ({ models: res.models }));
          })
          .catch(() => {
            console.error("[Config] failed to fetch config");
          })
          .finally(() => {
            fetchState = 2;
          });
      },

      // 新增：从多个文件创建会话组
      async createGroupFromFiles(files: File[]): Promise<ChatGroup | null> {
        try {
          // 先进行 IndexedDB 健康检查
          const isHealthy = await messageStorage.healthCheck();
          if (!isHealthy) {
            console.error(
              "[ChatStore] IndexedDB 健康检查失败，请重启浏览器重试",
            );
            showToast("存储系统异常，请重启浏览器重试");
            return null;
          }

          // 过滤支持的文件类型
          const supportedFiles = files.filter((file) => {
            const ext = file.name.split(".").pop()?.toLowerCase();
            return ["jpg", "jpeg", "png", "webp", "md", "txt"].includes(
              ext || "",
            );
          });

          if (supportedFiles.length === 0) {
            console.warn("[ChatStore] 没有找到支持的文件类型");
            showToast(
              "没有找到支持的文件类型（支持：jpg, jpeg, png, webp, md, txt）",
            );
            return null;
          }

          // 按文件名排序
          const sortedFiles = supportedFiles.sort((a, b) =>
            a.name.localeCompare(b.name),
          );

          // 创建组
          const groupId = nanoid();
          const groupTitle = `文件组 - ${new Date().toLocaleString("zh-CN")}`;

          const newGroup: ChatGroup = {
            id: groupId,
            title: groupTitle,
            sessionIds: [],
            messageCount: 0,
            status: "normal",
            pendingCount: 0,
            errorCount: 0,
            currentSessionIndex: 0,
          };

          // 为每个文件创建一个会话
          const groupSessions: GroupSession = {};
          const sessionIds: string[] = [];

          for (let i = 0; i < sortedFiles.length; i++) {
            const file = sortedFiles[i];
            const sessionId = nanoid();

            // 创建会话
            const session: ChatSession = {
              id: sessionId,
              title: Locale.Session.Title.DefaultGroup,
              sourceName: file.name, // 记录源文件名
              model: get().models[0], // 使用第一个可用模型
              messageCount: 0,
              status: "normal",
              groupId: groupId,
              lastUpdate: Date.now(),
              messages: [],
            };

            // 处理文件内容并设置为系统提示词
            let systemText = "";
            let systemImages: string[] = [];

            try {
              const ext = file.name.split(".").pop()?.toLowerCase();

              if (["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
                // 图片文件：上传图片并添加到系统提示词
                const { uploadImage } = await import("../utils/chat");
                const imageUrl = await uploadImage(file);
                systemImages.push(imageUrl);
              } else if (["md", "txt"].includes(ext || "")) {
                // 文本文件：读取内容作为系统提示词
                const text = await file.text();
                systemText = text;
              }

              // 保存系统提示词
              if (systemText.trim() || systemImages.length > 0) {
                await systemMessageStorage.save(sessionId, {
                  text: systemText,
                  images: systemImages,
                  scrollTop: 0,
                  selection: { start: 0, end: 0 },
                  updateAt: Date.now(),
                });
              }

              // 保存会话消息（空消息）
              await get().saveSessionMessages(session);

              // 更新会话统计信息
              await updateSessionStatsAsync(session);

              // 添加到组内会话
              groupSessions[sessionId] = session;
              sessionIds.push(sessionId);
            } catch (error) {
              console.error(`[ChatStore] 处理文件 ${file.name} 失败:`, error);
              // 即使处理失败，也创建会话，但标记为错误状态
              session.status = "error";
              groupSessions[sessionId] = session;
              sessionIds.push(sessionId);
            }
          }

          // 更新组信息
          newGroup.sessionIds = sessionIds;
          newGroup.messageCount = sessionIds.length;

          // 计算组状态
          const errorCount = sessionIds.filter(
            (id) => groupSessions[id].status === "error",
          ).length;
          const pendingCount = sessionIds.filter(
            (id) => groupSessions[id].status === "pending",
          ).length;
          newGroup.errorCount = errorCount;
          newGroup.pendingCount = pendingCount;
          newGroup.status = calculateGroupStatus(newGroup);

          // 更新 store 状态
          set((state) => ({
            groups: [newGroup, ...state.groups],
            groupSessions: {
              ...state.groupSessions,
              ...groupSessions,
            },
            currentGroupIndex: 0,
            chatListView: "groups" as const,
            chatListGroupView: "group-sessions" as const,
          }));

          console.log(
            `[ChatStore] 成功从 ${sortedFiles.length} 个文件创建会话组:`,
            newGroup.id,
          );
          showToast(`成功创建会话组，包含 ${sortedFiles.length} 个文件`);

          return newGroup;
        } catch (error) {
          console.error("[ChatStore] 从文件创建会话组失败:", error);
          showToast("创建会话组失败，请重试");
          return null;
        }
      },
    };

    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 5.4,
    storage: jchatStorage,

    /**
     * **核心改动：使用 partialize 排除 messages**
     * 这个函数在持久化状态之前被调用。
     * 我们返回一个不包含任何 session.messages 的新状态对象。
     */
    partialize: (state) => {
      // 创建一个没有 messages 的 state副本
      const stateToPersist = {
        ...state,
        sessions: state.sessions.map((session) => {
          const { messages, ...rest } = session;
          return { ...rest, messages: [] }; // 保持结构但清空messages
        }),
        // 清空 groupSessions 中所有会话的 messages
        groupSessions: Object.keys(state.groupSessions).reduce(
          (acc, sessionId) => {
            const session = state.groupSessions[sessionId];
            const { messages, ...rest } = session;
            acc[sessionId] = { ...rest, messages: [] };
            return acc;
          },
          {} as GroupSession,
        ),
      };
      return stateToPersist;
    },

    /**
     * **核心改动：在数据恢复后加载当前会话的消息**
     * 这个钩子在状态从 storage 成功恢复（rehydrated）后触发
     */
    onRehydrateStorage: () => {
      return (hydratedState, error) => {
        if (error) {
          console.error("[Store] An error happened during hydration", error);
        } else {
          // console.log("[Store] Hydration finished.");

          // 设置全局 hydration 状态
          isHydrated = true;

          // 执行所有等待 hydration 的回调
          hydrationCallbacks.forEach((callback) => {
            try {
              callback();
            } catch (error) {
              console.error("[Store] Error in hydration callback:", error);
            }
          });
          hydrationCallbacks.length = 0; // 清空回调数组

          // 只在客户端环境下执行消息加载
          if (typeof window !== "undefined") {
            // 确保在状态设置后调用，可以稍微延迟执行
            setTimeout(() => {
              const state = useChatStore.getState();
              const session = state.currentSession();

              if (session.groupId) {
                // 如果是组内会话，加载组内会话的消息
                state.loadGroupSessionMessages(session.id);
              } else {
                // 如果是普通会话，加载普通会话的消息
                state.loadSessionMessages(state.currentSessionIndex);
              }
            }, 0);
          }
        }
      };
    },

    migrate(persistedState: any, version: number) {
      return persistedState;
    },
  },
);

// 工具函数：确保同 batchId 的用户消息唯一，并插入新消息
function ensureUniqueUserMessage(
  messages: ChatMessage[],
  userMessage: ChatMessage,
  batchId: string,
): ChatMessage[] {
  const filtered = messages.filter((m) => {
    const parsed = parseGroupMessageId(m.id);
    return !(parsed.isValid && parsed.batchId === batchId && m.role === "user");
  });
  return [...filtered, userMessage];
}
