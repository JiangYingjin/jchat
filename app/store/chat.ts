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
  summarizeSession,
  prepareSendMessages,
  insertMessage,
  calculateMoveIndex,
  validateSessionIndex,
  updateSessionStats,
} from "../utils/session";

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
  chatListView: "sessions" as "sessions" | "groups" | "group-sessions",
  models: [] as string[],
  accessCode: "",
};

export const DEFAULT_TITLE = Locale.Store.DefaultTitle;

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
            updateSessionStats(s); // 重新计算统计信息
          });
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
              console.log(
                `[ChatStore] Saving group session messages: ${session.id}, count: ${messagesToSave.length}`,
              );
            } else {
              console.warn(
                `[ChatStore] Group session ${session.id} not found in groupSessions or has no messages`,
              );
            }
          } else {
            console.log(
              `[ChatStore] Saving regular session messages: ${session.id}, count: ${messagesToSave.length}`,
            );
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
        updateSessionStats(session);
        if (session.groupId) {
          get().updateGroupSession(session, () => {});
        } else {
          get().updateTargetSession(session, () => {});
        }
        await get().saveSessionMessages(session);
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

      async newSession() {
        const session = createEmptySession();
        // 为新会话保存空的 message 数组
        await get().saveSessionMessages(session);

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));

        // **修复：确保新会话的消息正确加载**
        await get().loadSessionMessages(0);
      },

      async newGroup(group: ChatGroup) {
        console.log(
          `[ChatStore] Creating new group: ${group.id}, title: ${group.title}`,
        );
        // 为组内的第一个会话创建并保存消息
        const firstSessionId = group.sessionIds[0];
        if (firstSessionId) {
          // 创建组内会话
          const emptySession = createEmptySession();
          emptySession.id = firstSessionId;
          emptySession.groupId = group.id;
          emptySession.title = group.title;

          console.log(
            `[ChatStore] Created group session: ${emptySession.id}, groupId: ${emptySession.groupId}`,
          );

          // 保存会话消息
          await get().saveSessionMessages(emptySession);

          // 将会话添加到 groupSessions 中
          set((state) => ({
            currentGroupIndex: 0,
            groups: [group].concat(state.groups),
            groupSessions: {
              ...state.groupSessions,
              [firstSessionId]: emptySession,
            },
          }));
          console.log(`[ChatStore] Group and session added to store`);
        } else {
          // 如果没有会话ID，只添加组
          set((state) => ({
            currentGroupIndex: 0,
            groups: [group].concat(state.groups),
          }));
          console.log(`[ChatStore] Group added without session`);
        }
      },

      // 新建组内会话
      async newGroupSession() {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          console.error("当前没有选中的组");
          return;
        }

        // 创建新的组内会话
        const newSession = createEmptySession();
        newSession.groupId = currentGroup.id;
        newSession.title = DEFAULT_TITLE;

        // 保存会话消息
        await get().saveSessionMessages(newSession);

        // 更新组和组内会话
        set((state) => {
          const newGroups = [...state.groups];
          const updatedGroup = {
            ...currentGroup,
            sessionIds: [...currentGroup.sessionIds, newSession.id],
            currentSessionIndex: currentGroup.sessionIds.length, // 设置为新会话的索引
          };
          newGroups[currentGroupIndex] = updatedGroup;

          return {
            groups: newGroups,
            groupSessions: {
              ...state.groupSessions,
              [newSession.id]: newSession,
            },
          };
        });

        // 加载新会话的消息
        await get().loadGroupSessionMessages(newSession.id);
      },

      // 设置聊天列表模式
      setchatListView(mode: "sessions" | "groups" | "group-sessions") {
        set({ chatListView: mode });
      },

      // 选择指定的组
      selectGroup(index: number) {
        const { groups, currentGroupIndex, groupSessions } = get();
        const targetGroup = groups[index];

        if (!targetGroup || targetGroup.sessionIds.length === 0) return;

        // 判断是否是第一次点击该组（当前组索引不是这个组）
        if (currentGroupIndex !== index) {
          // 第一次点击：切换到该组并加载第一个会话
          const firstSessionId = targetGroup.sessionIds[0];
          const firstSession = groupSessions[firstSessionId];

          if (firstSession) {
            // 切换到该组
            set({
              currentGroupIndex: index,
            });

            // 加载第一个会话的消息（如果还没加载）
            if (!firstSession.messages || firstSession.messages.length === 0) {
              get().loadGroupSessionMessages(firstSessionId);
            }
          }
        } else {
          // 第二次点击：切换到组内会话视图
          set({
            chatListView: "group-sessions",
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

        console.log(
          `[ChatStore] Selecting group session: index=${sessionIndex}, switchView=${switchToGroupSessionsView}`,
        );

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
              ? { chatListView: "group-sessions" }
              : {}),
          };
        });

        // 加载组内会话的消息
        const sessionId = currentGroup.sessionIds[sessionIndex];
        const session = get().groupSessions[sessionId];
        if (session && (!session.messages || session.messages.length === 0)) {
          // 只在消息未加载时才加载
          console.log(
            `[ChatStore] Loading messages for selected group session: ${sessionId}`,
          );
          get().loadGroupSessionMessages(sessionId);
        } else if (!session) {
          console.warn(
            `[ChatStore] Group session ${sessionId} not found in groupSessions`,
          );
        } else {
          console.log(
            `[ChatStore] Group session ${sessionId} messages already loaded`,
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
          console.log(
            `[ChatStore] Group session ${sessionId} messages already loaded`,
          );
          return;
        }

        try {
          console.log(
            `[ChatStore] Loading messages for group session ${sessionId}`,
          );
          // 从 messageStorage 异步加载消息
          const messages = await messageStorage.get(sessionId);
          console.log(
            `[ChatStore] Retrieved ${messages.length} messages from storage for group session ${sessionId}`,
          );

          set((state) => {
            const updatedSession = {
              ...session,
              messages: messages,
              messageCount: messages.length,
            };
            console.log(
              `[ChatStore] Updating groupSessions with ${messages.length} messages for session ${sessionId}`,
            );
            return {
              groupSessions: {
                ...state.groupSessions,
                [sessionId]: updatedSession,
              },
            };
          });
          console.log(
            `[ChatStore] Successfully loaded ${messages.length} messages for group session ${sessionId}`,
          );
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

        // 如果是组内唯一的会话，不允许删除
        if (currentGroup.sessionIds.length === 1) {
          showToast("组内必须至少保留一个会话");
          return;
        }

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
        };

        // 计算删除后的当前会话索引
        let newCurrentSessionIndex = currentGroup.currentSessionIndex;
        if (sessionIndex < currentGroup.currentSessionIndex) {
          newCurrentSessionIndex--;
        } else if (sessionIndex === currentGroup.currentSessionIndex) {
          // 如果删除的是当前会话，选择前一个会话，如果没有则选择下一个
          newCurrentSessionIndex = Math.max(0, sessionIndex - 1);
        }

        // 准备新的会话ID列表
        const newSessionIds = [...currentGroup.sessionIds];
        newSessionIds.splice(sessionIndex, 1);
        const newCurrentSessionId = newSessionIds[newCurrentSessionIndex];

        // 立即更新UI状态（从组内会话中移除）
        set((state) => {
          const newGroups = [...state.groups];

          newGroups[currentGroupIndex] = {
            ...currentGroup,
            sessionIds: newSessionIds,
            currentSessionIndex: newCurrentSessionIndex,
          };

          const newGroupSessions = { ...state.groupSessions };
          delete newGroupSessions[sessionId];

          return {
            groups: newGroups,
            groupSessions: newGroupSessions,
          };
        });

        // **在切换到新会话后，立即加载其消息**
        if (newCurrentSessionId) {
          await get().loadGroupSessionMessages(newCurrentSessionId);
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
          await get().loadGroupSessionMessages(sessionId);

          console.log(`[ChatStore] Group session ${sessionId} deletion undone`);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteMessageToast,
          {
            text: Locale.Chat.Revert,
            onClick: restoreGroupSession,
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
          const messagesToCopy = originalMessages.map((message) => ({
            ...message,
            id: nanoid(), // 只更新ID，保持其他属性不变
          }));

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
          await get().loadSessionMessages(deletedSessionIndex);

          console.log(`[DeleteSession] 已撤销删除会话 ${deletedSession.id}`);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteMessageToast,
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
          groups,
          currentGroupIndex,
          groupSessions,
          sessions,
          currentSessionIndex,
        } = get();

        // 组内会话模式：返回当前组的当前会话
        if (chatListView === "group-sessions") {
          const currentGroup = groups[currentGroupIndex];
          if (currentGroup && currentGroup.sessionIds.length > 0) {
            const currentSessionId =
              currentGroup.sessionIds[currentGroup.currentSessionIndex];
            const session = groupSessions[currentSessionId];
            if (session) {
              // console.log(
              //   `[ChatStore] Returning group session: ${session.id}, title: ${session.title}, message count: ${session.messages?.length || 0}`,
              // );
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
          set({ chatListView: "groups" });
        }

        // 普通模式：返回当前普通会话
        let index = currentSessionIndex;
        const validIndex = validateSessionIndex(index, sessions.length);
        if (validIndex !== index) {
          set(() => ({ currentSessionIndex: validIndex }));
          index = validIndex;
          // **修复：如果索引被纠正，异步加载新当前会话的消息**
          get().loadSessionMessages(validIndex);
        }

        console.log(
          `[ChatStore] Returning regular session: ${sessions[index].id}, title: ${sessions[index].title}`,
        );
        return sessions[index];
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
          get().summarizeSession(false, latest);
        } else {
          const latest =
            get().sessions.find((s) => s.id === targetSession.id) ||
            targetSession;
          get().updateTargetSession(latest, (session) => {
            session.lastUpdate = Date.now();
          });
          get().summarizeSession(false, latest);
        }
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
      ) {
        const session = get().currentSession();

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

        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: mContent,
        });

        const modelMessage = createMessage({
          role: "assistant",
          content: "",
          streaming: true,
          model: session.model,
        });

        // get recent messages
        let recentMessages = await get().prepareMessagesForApi();

        let sendMessages = prepareSendMessages(
          recentMessages,
          userMessage,
          messageIdx,
        );

        const messageIndex = session.messages.length + 1;

        // save user's and bot's message
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
            updateSessionStats(session);
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
            updateSessionStats(session);
          });
        }

        // 立即保存消息到独立存储
        console.log(
          `[ChatStore] onSendMessage: Saving messages for session ${session.id}, groupId: ${session.groupId}, current message count: ${session.messages.length}`,
        );
        await get().saveSessionMessages(session);

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
                updateSessionStats(session);
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session);
              });
            }
            // 异步保存消息更新 - 重新获取最新的会话状态
            const currentSession = get().currentSession();
            get().saveSessionMessages(currentSession);
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }
            if (session.groupId) {
              get().updateGroupSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session);
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session);
              });
            }
            // 异步保存消息更新 - 重新获取最新的会话状态
            const currentSession = get().currentSession();
            get().saveSessionMessages(currentSession);
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
            // 保存最终消息状态 - 重新获取最新的会话状态
            const currentSession = get().currentSession();
            console.log(
              `[ChatStore] onFinish: Saving final messages for session ${currentSession.id}, groupId: ${currentSession.groupId}, final message count: ${currentSession.messages.length}`,
            );
            get().saveSessionMessages(currentSession);
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
                updateSessionStats(session);
              });
            } else {
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                updateSessionStats(session);
              });
            }
            // 保存错误状态的消息 - 重新获取最新的会话状态
            const currentSession = get().currentSession();
            console.log(
              `[ChatStore] onError: Saving error messages for session ${currentSession.id}, groupId: ${currentSession.groupId}, error message count: ${currentSession.messages.length}`,
            );
            get().saveSessionMessages(currentSession);
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
        console.log(
          `[ChatStore] prepareMessagesForApi: session ${session.id}, groupId: ${session.groupId}, message count: ${session.messages?.length || 0}`,
        );

        // **核心改动：如果消息未加载，先加载它们**
        if (session && (!session.messages || session.messages.length === 0)) {
          console.log(
            `[ChatStore] prepareMessagesForApi: Loading messages for session ${session.id}`,
          );
          if (session.groupId) {
            await get().loadGroupSessionMessages(session.id);
          } else {
            await get().loadSessionMessages(get().currentSessionIndex);
          }
        }
        // get() 会获取最新状态，此时 messages 应该已加载
        const finalSession = get().currentSession();
        console.log(
          `[ChatStore] prepareMessagesForApi: Final session ${finalSession.id}, message count: ${finalSession.messages?.length || 0}`,
        );

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
          updateSessionStats(session);
          return { sessions };
        });
        // 保存最新
        const session = get().sessions[sessionIndex];
        if (session) {
          await get().saveSessionMessages(session);
        }
      },

      async resetSession(session: ChatSession) {
        if (session.groupId) {
          get().updateGroupSession(session, (session) => {
            session.messages = [];
            updateSessionStats(session);
          });
        } else {
          get().updateTargetSession(session, (session) => {
            session.messages = [];
            updateSessionStats(session);
          });
        }
        await get().saveSessionMessages(session);
      },

      async summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        await summarizeSession(targetSession, refreshTitle, (newTopic) => {
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

      // 更新组内会话并同步组标题
      updateGroupSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          // 一定要以 groupSessions 里的最新对象为基础，防止被旧对象覆盖
          const baseSession =
            state.groupSessions[targetSession.id] || targetSession;
          const updatedSession = { ...baseSession };
          const beforeMessageCount = updatedSession.messages?.length || 0;
          const beforeTargetMsgCount = targetSession.messages?.length || 0;
          updater(updatedSession);
          const afterMessageCount = updatedSession.messages?.length || 0;

          console.log(
            `[ChatStore] updateGroupSession: ${targetSession.id}, baseMsg: ${beforeMessageCount}, targetMsg: ${beforeTargetMsgCount} -> ${afterMessageCount}`,
          );

          const newGroupSessions = {
            ...state.groupSessions,
            [targetSession.id]: updatedSession,
          };

          // 判断是否为组内第一个会话
          let newGroups = state.groups;
          if (targetSession.groupId) {
            const groupIndex = state.groups.findIndex(
              (g) => g.id === targetSession.groupId,
            );
            if (groupIndex !== -1) {
              const group = state.groups[groupIndex];
              const firstSessionId = group.sessionIds[0];
              if (firstSessionId === targetSession.id) {
                // 同步组标题
                newGroups = [...state.groups];
                newGroups[groupIndex] = {
                  ...group,
                  title: updatedSession.title,
                };
              }
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
      // // 从版本 5.3 迁移到 5.4：添加分组功能
      // if (version < 5.4) {
      //   console.log("[Store] Migrating from version", version, "to 5.4");

      //   const migratedState = { ...persistedState };

      //   // 1. 为所有 ChatSession 添加 groupId 字段
      //   if (migratedState.sessions && Array.isArray(migratedState.sessions)) {
      //     migratedState.sessions = migratedState.sessions.map(
      //       (session: any) => {
      //         if (session && typeof session === "object") {
      //           return {
      //             ...session,
      //             groupId: null, // 默认所有会话都不属于任何分组
      //           };
      //         }
      //         return session;
      //       },
      //     );
      //   }

      //   // 2. 添加新的分组相关字段
      //   migratedState.groups = [];
      //   migratedState.groupSessions = {};
      //   migratedState.currentGroupIndex = 0;

      //   // 3. 如果存在旧的 groups 数据，需要迁移格式
      //   if (migratedState.groups && Array.isArray(migratedState.groups)) {
      //     migratedState.groups = migratedState.groups.map((group: any) => {
      //       if (group && typeof group === "object") {
      //         return {
      //           id: group.id || nanoid(),
      //           title: group.title || DEFAULT_TITLE,
      //           sessionIds: group.sessionIds || [],
      //           messageCount: group.messageCount || 0,
      //           status: group.status || "normal",
      //           pendingCount: group.pendingCount || 0,
      //           errorCount: group.errorCount || 0,
      //           expanded: group.expanded !== undefined ? group.expanded : false,
      //           currentSessionIndex: group.currentSessionIndex || 0,
      //         };
      //       }
      //       return group;
      //     });
      //   }

      //   console.log("[Store] Migration to 5.4 completed");
      //   return migratedState;
      // }

      return persistedState;
    },
  },
);
