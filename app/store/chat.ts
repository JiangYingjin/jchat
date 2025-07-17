import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi, getHeaders } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import { StoreKey } from "../constant";
import Locale from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { chatInputStorage } from "./input";
import { storageHealthManager } from "../utils/storage-helper";
import { uploadImage } from "../utils/chat";
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
  updateSessionStatsBasic,
  updateSessionStats,
  filterOutUserMessageByBatchId,
} from "../utils/session";
import { parseGroupMessageId } from "../utils/group";
import { calculateGroupStatus } from "../utils/group";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

// 全局 hydration 状态管理
let isHydrated = false;
const hydrationCallbacks: (() => void)[] = [];

// 添加状态锁机制，防止并发操作导致数据不一致
let isInitializing = false;
let initializationPromise: Promise<void> | null = null;

// 添加存储健康状态跟踪
let storageHealthy = true;

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

// 添加安全的状态初始化函数
async function safeInitializeStore(): Promise<void> {
  // 防止重复初始化
  if (isInitializing) {
    return initializationPromise || Promise.resolve();
  }

  isInitializing = true;
  initializationPromise = (async () => {
    try {
      // 导入存储健康管理器

      // 检查存储健康状态
      const isHealthy = await storageHealthManager.checkHealth();
      if (!isHealthy) {
        console.warn("[ChatStore] 存储系统异常，但继续使用现有数据");
        storageHealthy = false;
        return;
      }

      const state = useChatStore.getState();
      const session = state.currentSession();

      if (session) {
        if (session.groupId) {
          await state.loadGroupSessionMessages(session.id);
        } else {
          await state.loadSessionMessages(state.currentSessionIndex);
        }
      }
    } catch (error) {
      console.error("[ChatStore] 初始化失败:", error);
      storageHealthy = false;
    } finally {
      isInitializing = false;
      initializationPromise = null;
    }
  })();

  return initializationPromise;
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
  batchApplyMode: false, // 批量应用模式
  activeBatchRequests: 0, // 活跃的批量请求计数器
  mobileViewState: "sidebar" as "sidebar" | "chat" | "settings", // 移动端界面状态
};

export const DEFAULT_TITLE = Locale.Session.Title.Default;

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    const methods = {
      // 新增：渲染优化相关状态管理
      batchApplyMode: false, // 批量应用模式标志
      activeBatchRequests: 0, // 活跃的批量请求计数器

      // 新增：设置批量应用模式
      setBatchApplyMode(enabled: boolean): void {
        set({ batchApplyMode: enabled });

        // 启用批量模式时重置计数器
        if (enabled) {
          set({ activeBatchRequests: 0 });
        }
      },

      // 移动端界面状态管理
      setMobileViewState(state: "sidebar" | "chat" | "settings"): void {
        set({ mobileViewState: state });
      },

      showSidebarOnMobile(): void {
        set({ mobileViewState: "sidebar" });
      },

      showChatOnMobile(): void {
        set({ mobileViewState: "chat" });
      },

      showSettingsOnMobile(): void {
        set({ mobileViewState: "settings" });
      },

      // 新增：增加活跃批量请求计数
      incrementBatchRequest(): void {
        const state = get();
        if (state.batchApplyMode) {
          const newCount = state.activeBatchRequests + 1;
          set({ activeBatchRequests: newCount });
        }
      },

      // 新增：减少活跃批量请求计数，当计数为0时自动退出批量模式
      decrementBatchRequest(): void {
        const state = get();
        if (state.batchApplyMode && state.activeBatchRequests > 0) {
          const newCount = state.activeBatchRequests - 1;
          set({ activeBatchRequests: newCount });

          // 当所有请求完成时自动退出批量模式
          if (newCount === 0) {
            state.setBatchApplyMode(false);
            showToast("🎉 批量应用全部完成！");
          }
        }
      },

      // 新增：判断会话是否为当前可见会话
      isCurrentVisibleSession(sessionId: string): boolean {
        const state = get();
        const currentSession = state.currentSession();
        return currentSession.id === sessionId;
      },

      // 新增：智能更新会话状态（只有当前会话触发UI重新渲染）
      smartUpdateSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
        forceRender: boolean = false,
      ): void {
        const state = get();
        const isVisible = state.isCurrentVisibleSession(session.id);

        if (session.groupId) {
          state.updateGroupSession(session, (sessionToUpdate) => {
            updater(sessionToUpdate);

            // 极简渲染策略：只有可见会话或强制渲染时才触发UI更新
            const shouldRender = isVisible || forceRender;

            if (shouldRender) {
              sessionToUpdate.messages = sessionToUpdate.messages.concat();
            }
            updateSessionStatsBasic(sessionToUpdate);
          });
        } else {
          state.updateSession(session, (sessionToUpdate) => {
            updater(sessionToUpdate);

            // 极简渲染策略：只有可见会话或强制渲染时才触发UI更新
            const shouldRender = isVisible || forceRender;

            if (shouldRender) {
              sessionToUpdate.messages = sessionToUpdate.messages.concat();
            }
            updateSessionStatsBasic(sessionToUpdate);
          });
        }
      },

      // 新增：加载指定会话的消息
      async loadSessionMessages(sessionIndex: number): Promise<void> {
        // 只在客户端环境下执行
        if (typeof window === "undefined") return;

        const sessions = get().sessions;
        const session = sessions[sessionIndex];
        if (!session) return;

        // 如果消息已经加载（非空），则不重复加载
        if (session.messages && session.messages.length > 0) return;

        // 如果存储不健康，使用空消息数组
        if (!storageHealthy) {
          get().updateSession(session, (session) => {
            session.messages = [];
            updateSessionStatsBasic(session);
          });
          return;
        }

        try {
          // 从 messageStorage 异步加载消息
          const messages = await messageStorage.get(session.id);
          get().updateSession(session, (session) => {
            session.messages = messages || [];
            updateSessionStatsBasic(session); // 先同步更新基础统计信息
          });

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = get().sessions[sessionIndex];
          if (updatedSession) {
            try {
              await updateSessionStats(updatedSession);
              get().updateSession(updatedSession, (session) => {}); // 强制触发状态更新以重新渲染
            } catch (error) {
              console.error(
                `[ChatStore] Failed to update session stats for ${session.id}:`,
                error,
              );
            }
          }
        } catch (error) {
          console.error(
            `[ChatStore] Failed to load messages for session ${session.id}`,
            error,
          );
          // 加载失败时使用空消息数组，防止应用崩溃
          get().updateSession(session, (session) => {
            session.messages = [];
            updateSessionStatsBasic(session);
          });
        }
      },

      // 新增：保存会话消息到独立存储
      async saveSessionMessages(
        session: ChatSession,
        force: boolean = false,
      ): Promise<void> {
        try {
          let messagesToSave = session.messages;

          // 对于组内会话，需要从 groupSessions 中获取最新的消息
          if (session.groupId) {
            const groupSession = get().groupSessions[session.id];
            if (groupSession && groupSession.messages) {
              messagesToSave = groupSession.messages;
            }
          }

          const success = await messageStorage.save(
            session.id,
            messagesToSave,
            force,
          );
        } catch (error) {
          console.error(
            `[ChatStore] Failed to save messages for session ${session.id}`,
            error,
          );
        }
      },

      // 优化：会话切换时的清理
      selectSession(index: number) {
        const validIndex = validateSessionIndex(index, get().sessions.length);
        if (validIndex !== index) {
          index = validIndex;
        }

        set((state) => ({
          currentSessionIndex: index,
          chatListView: "sessions",
        }));

        // 异步加载消息，避免阻塞UI切换
        setTimeout(() => {
          get().loadSessionMessages(index);
          // 强制渲染目标会话以确保显示最新内容
          const targetSession = get().sessions[index];
          if (targetSession) {
            get().smartUpdateSession(targetSession, () => {}, true);
          }
        }, 0);
      },

      // 优化：组会话切换时的清理
      selectGroupSession(index: number, switchToChatView: boolean = true) {
        const state = get();
        const currentGroup = state.groups[state.currentGroupIndex];
        if (!currentGroup || index >= currentGroup.sessionIds.length) {
          return;
        }

        // 更新当前组的会话索引
        set((state) => {
          const newGroups = [...state.groups];
          newGroups[state.currentGroupIndex] = {
            ...newGroups[state.currentGroupIndex],
            currentSessionIndex: index,
          };
          return {
            groups: newGroups,
            chatListView: switchToChatView ? "groups" : state.chatListView,
            chatListGroupView: "group-sessions",
          };
        });

        const sessionId = currentGroup.sessionIds[index];

        // 异步加载消息，避免阻塞UI切换
        setTimeout(() => {
          get().loadGroupSessionMessages(sessionId);
          // 强制渲染目标会话以确保显示最新内容
          const targetSession = get().groupSessions[sessionId];
          if (targetSession) {
            get().smartUpdateSession(targetSession, () => {}, true);
          }
        }, 0);
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

        // 改进健康检查逻辑：失败时降级但不阻止操作
        try {
          const isHealthy = await storageHealthManager.checkHealth();
          if (!isHealthy) {
            console.warn("[ChatStore] 存储系统异常，但继续创建会话");
            storageHealthy = false;
          } else {
            storageHealthy = true;
          }
        } catch (error) {
          console.warn("[ChatStore] 健康检查失败，继续创建会话:", error);
          storageHealthy = false;
        }

        // 只有在存储健康时才保存消息
        if (storageHealthy) {
          try {
            await get().saveSessionMessages(session);
          } catch (error) {
            console.error("[ChatStore] 保存会话消息失败:", error);
          }
        }

        set((state) => {
          return {
            currentSessionIndex: 0,
            sessions: [session].concat(state.sessions),
          };
        });

        // 确保新会话的消息正确加载
        if (storageHealthy) {
          try {
            await get().loadSessionMessages(0);
          } catch (error) {
            console.error("[ChatStore] 加载会话消息失败:", error);
          }
        }
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
            await updateSessionStats(updatedSession);

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
        } else if (newSessionIds[newCurrentSessionIndex]) {
          // 如果是切换到现有会话，加载其消息
          await get().loadGroupSessionMessages(
            newSessionIds[newCurrentSessionIndex],
          );
        }

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.delete(sessionId),
              chatInputStorage.delete(sessionId),
              systemMessageStorage.delete(sessionId),
            ]);
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
            // 使用 setTimeout 避免在渲染期间触发状态更新
            setTimeout(() => {
              set(() => ({ currentSessionIndex: validIndex }));
              get().loadSessionMessages(validIndex);
            }, 0);
            index = validIndex;
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
            // 如果组内会话模式但没有找到会话，使用 setTimeout 避免在渲染期间触发状态更新
            setTimeout(() => {
              set({ chatListGroupView: "groups" });
            }, 0);
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
          // 使用 setTimeout 避免在渲染期间触发状态更新
          setTimeout(() => {
            set(() => ({ currentSessionIndex: validIndex }));
            get().loadSessionMessages(validIndex);
          }, 0);
          index = validIndex;
        }
        const session = sessions[index];
        return session;
      },

      handleMessageComplete(
        message: ChatMessage,
        session: ChatSession,
        usage?: any,
      ) {
        const latestSession = get().getLatestSession(session);
        const updateSession = (session: ChatSession) => {
          session.lastUpdate = Date.now();
        };
        if (latestSession.groupId) {
          get().updateGroupSession(latestSession, updateSession);
        } else {
          get().updateSession(latestSession, updateSession);
        }
        get().generateSessionTitle(false, latestSession);
      },

      getLatestSession(session: ChatSession) {
        return session.groupId
          ? get().groupSessions[session.id]
          : get().sessions.find((s) => s.id === session.id) || session;
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
        targetSessionId?: string, // 新增：指定目标会话ID
        batchId?: string, // 新增：指定batchId，用于批量应用
        modelBatchId?: string, // 新增：指定模型消息的batchId，用于批量应用时保持模型消息batch id一致
      ) {
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
          recentMessages = await prepareMessagesForApi(session);
        } else {
          // 否则使用当前会话的消息（保持原有逻辑）
          recentMessages = await get().getCurrentSessionMessages();
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

        // 🔧 优化：基于 batchId 的消息更新逻辑
        if (session.groupId && userBatchId) {
          // 查找相同 batchId 的用户消息
          const existingUserMsgIndex = session.messages.findIndex((m) => {
            const parsed = parseGroupMessageId(m.id);
            return (
              parsed.isValid &&
              parsed.batchId === userBatchId &&
              m.role === "user"
            );
          });

          if (existingUserMsgIndex !== -1) {
            // 找到现有用户消息，更新其内容
            get().smartUpdateSession(session, (session) => {
              session.messages[existingUserMsgIndex] = {
                ...session.messages[existingUserMsgIndex],
                content: mContent,
              };

              // 删除该用户消息后面紧跟的模型消息（如果存在）
              const nextMsgIndex = existingUserMsgIndex + 1;
              if (
                nextMsgIndex < session.messages.length &&
                session.messages[nextMsgIndex].role === "assistant"
              ) {
                session.messages.splice(nextMsgIndex, 1);
              }

              // 在用户消息后插入新的模型消息
              session.messages.splice(
                existingUserMsgIndex + 1,
                0,
                modelMessage,
              );
            });
          } else {
            // 没有找到现有消息，追加到末尾
            get().smartUpdateSession(session, (session) => {
              session.messages.push(userMessage, modelMessage);
            });
          }
        } else {
          // 非组内会话或没有指定 batchId，使用原有的 insertMessage 逻辑
          get().smartUpdateSession(session, (session) => {
            const savedUserMessage = {
              ...userMessage,
              content: mContent,
            };

            // 🔧 修复普通会话重试逻辑：当传递了 messageIdx 时，先删除原有消息再插入
            if (typeof messageIdx === "number" && messageIdx >= 0) {
              // 删除从 messageIdx 开始的用户消息和对应的模型回复
              // 通常是连续的 user -> assistant 对
              const deleteCount =
                messageIdx + 1 < session.messages.length &&
                session.messages[messageIdx + 1].role === "assistant"
                  ? 2
                  : 1;

              // 删除原有的消息
              session.messages.splice(messageIdx, deleteCount);

              // 在原位置插入新的用户消息和模型消息
              session.messages.splice(
                messageIdx,
                0,
                savedUserMessage,
                modelMessage,
              );
            } else {
              // 没有传 messageIdx，追加到末尾
              session.messages = insertMessage(
                session.messages,
                savedUserMessage,
                modelMessage,
                messageIdx,
              );
            }
          });
        }

        // 立即保存消息到独立存储 - 获取最新的会话对象
        const latestSessionForSave = get().getLatestSession(session);

        await get().saveSessionMessages(latestSessionForSave);

        // 异步更新包含系统提示词的完整统计信息
        const currentSession = get().currentSession();
        await updateSessionStats(currentSession);

        // 根据会话类型更新状态
        if (currentSession.groupId) {
          get().updateGroupSession(currentSession, (session) => {});
        } else {
          get().updateSession(currentSession, (session) => {});
        }

        // 🔧 批量模式：开始请求时增加计数器
        get().incrementBatchRequest();

        const api: ClientApi = getClientApi();
        // make request
        api.llm.chat({
          messages: sendMessages,
          model: session.model,
          onUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.content = message;
            }

            // 🔧 优化：只有当前可见会话触发UI渲染，后台会话完全不渲染
            get().smartUpdateSession(session, () => {});

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnUpdate = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                // 异步保存消息更新
                await get().saveSessionMessages(latestSessionOnUpdate);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnUpdate);

                // 最终状态同步（但不阻塞流式渲染）
                if (latestSessionOnUpdate.groupId) {
                  get().updateGroupSession(
                    latestSessionOnUpdate,
                    (session) => {},
                  );
                } else {
                  get().updateSession(latestSessionOnUpdate, (session) => {});
                }
              })
              .catch((error) => {
                console.error("[onSendMessage] onUpdate 异步操作失败:", error);
              });
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }

            // 🔧 优化：只有当前可见会话触发UI渲染，后台会话完全不渲染
            get().smartUpdateSession(session, () => {});

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnReasoning = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                // 异步保存消息更新
                await get().saveSessionMessages(latestSessionOnReasoning);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnReasoning);

                // 最终状态同步（但不阻塞流式渲染）
                if (latestSessionOnReasoning.groupId) {
                  get().updateGroupSession(
                    latestSessionOnReasoning,
                    (session) => {},
                  );
                } else {
                  get().updateSession(
                    latestSessionOnReasoning,
                    (session) => {},
                  );
                }
              })
              .catch((error) => {
                console.error(
                  "[onSendMessage] onReasoningUpdate 异步操作失败:",
                  error,
                );
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

              get().handleMessageComplete(modelMessage, session, usage);
            }

            // 🔧 优化：智能更新UI状态，完成时强制渲染确保最终状态同步
            get().smartUpdateSession(session, () => {}, true);

            // 保存最终消息状态 - 获取最新会话对象
            const latestSessionOnFinish = get().getLatestSession(session);

            // 🔥 Stream 完成后强制保存（绕过频率限制）
            get().saveSessionMessages(latestSessionOnFinish, true);
            ChatControllerPool.remove(session.id, modelMessage.id);

            // 🔧 批量模式：请求完成时减少计数器
            get().decrementBatchRequest();
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

            // 🔧 优化：智能更新UI状态，错误时强制渲染确保错误状态显示
            get().smartUpdateSession(session, () => {}, true);

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnError = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                console.log("[onSendMessage] ❌ onError 保存消息", {
                  sessionId: session.id,
                  errorMessage: error.message,
                  isAborted,
                  userMessageError: userMessage.isError,
                  modelMessageError: modelMessage.isError,
                  latestMessageCount:
                    latestSessionOnError.messages?.length || 0,
                  step: "onError",
                });

                // 异步保存错误状态的消息（强制保存）
                await get().saveSessionMessages(latestSessionOnError, true);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnError);

                // 最终状态同步（但不阻塞错误处理）
                if (latestSessionOnError.groupId) {
                  get().updateGroupSession(
                    latestSessionOnError,
                    (session) => {},
                  );
                } else {
                  get().updateSession(latestSessionOnError, (session) => {});
                }
              })
              .catch((saveError) => {
                console.error(
                  "[onSendMessage] onError 异步操作失败:",
                  saveError,
                );
              });

            ChatControllerPool.remove(
              session.id,
              modelMessage.id ?? messageIndex,
            );

            // 🔧 批量模式：请求出错时也减少计数器
            get().decrementBatchRequest();

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

      async getCurrentSessionMessages() {
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
        return await prepareMessagesForApi(finalSession);
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
          updateSessionStatsBasic(session); // 先同步更新基础统计信息
          return { sessions };
        });
        // 保存最新
        const session = get().sessions[sessionIndex];
        if (session) {
          await get().saveSessionMessages(session);

          // 异步更新包含系统提示词的完整统计信息
          await updateSessionStats(session);
          get().updateSession(session, (session) => {});
        }
      },

      async generateSessionTitle(
        refreshTitle: boolean = false,
        session: ChatSession,
      ) {
        await generateSessionTitle(session, refreshTitle, (newTitle) => {
          // 根据会话类型选择更新方法
          if (session.groupId) {
            get().updateGroupSession(session, (session) => {
              session.title = newTitle;
            });
          } else {
            get().updateSession(session, (session) => {
              session.title = newTitle;
            });
          }
        });
      },

      updateSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          const index = state.sessions.findIndex((s) => s.id === session.id);
          if (index < 0) return {}; // 如果会话不存在，直接返回空对象
          const updatedSession = { ...state.sessions[index] }; // 修改浅拷贝
          updater(updatedSession); // 修改会话浅拷贝
          const sessions = [...state.sessions]; // 会话数组浅拷贝
          sessions[index] = updatedSession; // 更新会话数组浅拷贝
          return { sessions }; // 返回包含新 sessions 数组的状态对象，Zustand 会将这个对象与当前状态合并，触发组件重新渲染
        });
      },

      // 更新组内会话并同步组标题和消息数量
      updateGroupSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          // 一定要以 groupSessions 里的最新对象为基础，防止被旧对象覆盖
          const baseSession = state.groupSessions[session.id] || session;
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
            [session.id]: updatedSession,
          };

          // 更新组状态
          let newGroups = state.groups;
          if (session.groupId) {
            const groupIndex = state.groups.findIndex(
              (g) => g.id === session.groupId,
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
              if (firstSessionId === session.id) {
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
              await updateSessionStats(session);

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

          showToast(`成功创建会话组，包含 ${sortedFiles.length} 个文件`);

          return newGroup;
        } catch (error) {
          console.error("[ChatStore] 从文件创建会话组失败:", error);
          showToast("创建会话组失败，请重试");
          return null;
        }
      },

      // 统一管理导出格式的读取
      async getExportFormat(): Promise<string> {
        try {
          const format = await jchatStorage.getItem(StoreKey.ExportFormat);
          return typeof format === "string" ? format : "image";
        } catch (e) {
          return "image";
        }
      },
      // 统一管理导出格式的保存
      async setExportFormat(format: string): Promise<void> {
        try {
          await jchatStorage.setItem(StoreKey.ExportFormat, format);
        } catch (e) {
          // ignore
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
     * **核心改动：使用 partialize 排除 messages 和 mobileViewState**
     * 这个函数在持久化状态之前被调用。
     * 我们返回一个不包含任何 session.messages 和 mobileViewState 的新状态对象。
     */
    partialize: (state) => {
      // 创建一个没有 messages 和 mobileViewState 的 state副本
      const { mobileViewState, ...stateWithoutMobileView } = state;
      const stateToPersist = {
        ...stateWithoutMobileView,
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
      return stateToPersist as any; // 使用 any 类型避免复杂的类型推断问题
    },

    /**
     * **核心改动：在数据恢复后安全加载当前会话的消息**
     * 这个钩子在状态从 storage 成功恢复（rehydrated）后触发
     */
    onRehydrateStorage: () => {
      return (hydratedState, error) => {
        if (error) {
          console.error("[Store] An error happened during hydration", error);
          // 即使 hydration 失败，也要设置 hydrated 状态，避免无限等待
          isHydrated = true;
          hydrationCallbacks.forEach((callback) => {
            try {
              callback();
            } catch (error) {
              console.error("[Store] Error in hydration callback:", error);
            }
          });
          hydrationCallbacks.length = 0;
        } else {
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
            // 使用安全的初始化函数，防止并发和错误
            setTimeout(() => {
              safeInitializeStore().catch((error) => {
                console.error("[Store] 安全初始化失败:", error);
              });
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
