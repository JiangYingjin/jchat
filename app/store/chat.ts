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
import {
  createMessage,
  createEmptySession,
  createBranchSession,
  prepareMessagesForApi,
  summarizeSession,
  prepareSendMessages,
  insertMessage,
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

/**
 * 基础会话单元 (The Basic Session Entity)
 * 这是一个纯粹的聊天会话，不关心自己是否属于某个组。
 * 它是我们状态数据库中的 "sessions" 表的行记录。
 */
export interface ChatSession {
  id: string; // 全局唯一标识符，例如 "session-abc-123"
  title: string;
  model: string; // 当前会话选择的模型
  messageCount: number; // 消息数量
  status: "normal" | "error" | "pending"; // 会话状态：正常、错误、用户消息结尾
  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  lastUpdate: number;
  messages: ChatMessage[];
}

/**
 * 会话组 (The Session Group Entity)
 * 这是一个容器，用于组织和管理多个 ChatSession。
 * 它本身不存储消息，只存储关系和组级别的状态。
 * 它是我们状态数据库中的 "groups" 表的行记录。
 */
export interface SessionGroup {
  id: string; // 全局唯一标识符，例如 "group-xyz-456"

  // 核心关系：只存储子会话的 ID 列表。这是范式化的关键。
  sessionIds: string[];

  // 派生数据与元数据
  title: string; // 通常是第一个子会话的标题，也可由用户自定义
  lastUpdate: number; // 以组内最新的会话更新时间为准

  // UI 状态：这些状态与组的展示逻辑紧密相关
  isExpandedInSidebar?: boolean; // 标记在侧边栏是否处于“展开”状态
  activeSubSessionId?: string; // 标记在聊天视图中，当前显示的是哪个子会话
}

// in app/store/chat.ts

const DEFAULT_CHAT_STATE = {
  accessCode: "",
  models: [] as string[],

  // 1. "sessions" 表: 存储所有 ChatSession 实体
  // key 是 ChatSession.id，value 是 ChatSession 对象。
  // O(1) 复杂度即可按 ID 访问任何会话，无论它是否在组内。
  sessionsRecord: {} as Record<string, ChatSession>,

  // 2. "groups" 表: 存储所有 SessionGroup 实体
  // key 是 SessionGroup.id，value 是 SessionGroup 对象。
  groups: {} as Record<string, SessionGroup>,

  // 3. 侧边栏的显示顺序 (The "View")
  // 数组里只存储 ID，这些 ID 要么指向一个 SessionGroup，要么指向一个独立的 ChatSession。
  // UI 渲染侧边栏时，只需遍历此数组。
  sessionOrder: [] as string[],

  // 4. 当前激活的上下文 (The "Active Context")
  // 存储当前在侧边栏被高亮选中的条目的 ID。
  // 这个 ID 可以是 group ID，也可以是独立的 session ID。
  activeId: null as string | null,
};

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    const methods = {
      // 新增：加载指定会话的消息
      async loadSessionMessages(sessionId: string): Promise<void> {
        // 只在客户端环境下执行
        if (typeof window === "undefined") return;

        const { sessionsRecord } = get();
        const session = sessionsRecord[sessionId];
        if (!session) return;

        // 如果消息已经加载（非空），则不重复加载
        if (session.messages && session.messages.length > 0) return;

        try {
          // 从 messageStorage 异步加载消息
          const messages = await messageStorage.getMessages(session.id);

          // 直接更新状态，确保数据同步
          const { sessionsRecord: currentRecord } = get();
          const currentSession = currentRecord[sessionId];

          if (currentSession) {
            // 更新 sessionsRecord 中的会话
            const updatedSession = { ...currentSession, messages };
            updateSessionStats(updatedSession);

            const updatedRecord = { ...currentRecord };
            updatedRecord[sessionId] = updatedSession;

            set(() => ({
              sessionsRecord: updatedRecord,
            }));
          }
        } catch (error) {
          console.error(
            `[ChatStore] Failed to load messages for session ${sessionId}`,
            error,
          );
        }
      },

      // 新增：保存会话消息到独立存储
      async saveSessionMessages(session: ChatSession): Promise<void> {
        try {
          await messageStorage.saveMessages(session.id, session.messages || []);
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
        get().updateTargetSession(session, () => {});
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
          sessionsRecord: {
            ...state.sessionsRecord,
            [newSession.id]: newSession,
          },
          sessionOrder: [newSession.id, ...state.sessionOrder],
          activeId: newSession.id,
        }));
      },

      selectSession(sessionId: string) {
        const { sessionsRecord } = get();
        const session = sessionsRecord[sessionId];

        if (session) {
          set({ activeId: sessionId });
          // 当选择一个新会话时，异步触发消息加载
          setTimeout(() => {
            get().loadSessionMessages(sessionId);
          }, 0);
        }
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessionOrder, activeId } = state;

          // move session in sessionOrder
          const newSessionOrder = [...sessionOrder];
          if (from < newSessionOrder.length && to < newSessionOrder.length) {
            const sessionId = newSessionOrder[from];
            newSessionOrder.splice(from, 1);
            newSessionOrder.splice(to, 0, sessionId);
          }

          return {
            sessionOrder: newSessionOrder,
            activeId: activeId, // activeId 保持不变
          };
        });
      },

      async newSession() {
        const session = createEmptySession();
        // 为新会话保存空的 message 数组
        await get().saveSessionMessages(session);

        set((state) => ({
          sessionsRecord: { ...state.sessionsRecord, [session.id]: session },
          sessionOrder: [session.id, ...state.sessionOrder],
          activeId: session.id,
        }));
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
            const success = await systemMessageStorage.saveSystemMessage(
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
          sessionsRecord: {
            ...state.sessionsRecord,
            [newSession.id]: newSession,
          },
          sessionOrder: [newSession.id, ...state.sessionOrder],
          activeId: newSession.id, // 切换到新创建的分支会话
        }));

        // 确保新会话的消息已正确加载（虽然是新创建的，但为了保险起见）
        await get().loadSessionMessages(newSession.id);

        return newSession;
      },

      nextSession(delta: number) {
        const { sessionOrder, activeId } = get();
        const n = sessionOrder.length;
        if (n === 0) return;

        const currentIndex = activeId ? sessionOrder.indexOf(activeId) : 0;
        const limit = (x: number) => (x + n) % n;
        const nextIndex = limit(currentIndex + delta);
        const nextSessionId = sessionOrder[nextIndex];

        if (nextSessionId) {
          get().selectSession(nextSessionId);
        }
      },

      async deleteSessionByIndex(index: number) {
        const { sessionOrder, sessionsRecord } = get();
        const deletingLastSession = sessionOrder.length === 1;
        const sessionIdToDelete = sessionOrder[index];
        const sessionToDelete = sessionIdToDelete
          ? sessionsRecord[sessionIdToDelete]
          : undefined;

        if (!sessionToDelete) return;

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          sessionsRecord: get().sessionsRecord,
          sessionOrder: get().sessionOrder,
          activeId: get().activeId,
        };

        // 准备新的状态
        const {
          sessionsRecord: currentRecord,
          sessionOrder: currentOrder,
          activeId,
        } = get();
        const newSessionOrder = currentOrder.filter(
          (id) => id !== sessionToDelete.id,
        );
        const newSessionsRecord = { ...currentRecord };
        let newActiveId = activeId;

        // 从 sessionsRecord 中删除会话
        delete newSessionsRecord[sessionToDelete.id];

        if (deletingLastSession) {
          const newSession = createEmptySession();
          newSessionsRecord[newSession.id] = newSession;
          newSessionOrder.push(newSession.id);
          newActiveId = newSession.id;
          // 为新创建的空会话保存（空的）消息
          await get().saveSessionMessages(newSession);
        } else if (activeId === sessionToDelete.id) {
          // 如果删除的是当前活跃会话，选择下一个
          const nextIndex = Math.min(index, newSessionOrder.length - 1);
          newActiveId = newSessionOrder[nextIndex] || null;
        }

        // 立即更新UI状态
        set(() => ({
          sessionsRecord: newSessionsRecord,
          sessionOrder: newSessionOrder,
          activeId: newActiveId,
        }));

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.deleteMessages(sessionToDelete.id),
              chatInputStorage.deleteChatInput(sessionToDelete.id),
              systemMessageStorage.deleteSystemMessage(sessionToDelete.id),
            ]);
            console.log(
              `[DeleteSession] 已删除会话 ${sessionToDelete.id} 的所有数据`,
            );
          } catch (error) {
            console.error(
              `[DeleteSession] 删除会话 ${sessionToDelete.id} 的数据失败:`,
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
          await get().loadSessionMessages(sessionToDelete.id);

          console.log(`[DeleteSession] 已撤销删除会话 ${sessionToDelete.id}`);
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

      async deleteSessionById(sessionId: string) {
        const state = get();
        const { sessionsRecord, sessionOrder, activeId } = state;

        // 检查会话是否存在
        const sessionToDelete = sessionsRecord[sessionId];
        if (!sessionToDelete) {
          console.warn(`[DeleteSession] Session ${sessionId} not found`);
          return;
        }

        const deletingLastSession = Object.keys(sessionsRecord).length === 1;
        const sessionOrderIndex = sessionOrder.indexOf(sessionId);

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          sessionsRecord: { ...sessionsRecord },
          sessionOrder: [...sessionOrder],
          activeId: activeId,
        };

        // 准备新的状态
        const newSessionsRecord = { ...sessionsRecord };
        const newSessionOrder = sessionOrder.filter((id) => id !== sessionId);
        let newActiveId = activeId;

        // 从 sessionsRecord 中删除会话
        delete newSessionsRecord[sessionId];

        // 更新 activeId
        if (activeId === sessionId) {
          if (deletingLastSession) {
            // 如果删除的是最后一个会话，创建新会话
            const newSession = createEmptySession();
            newSessionsRecord[newSession.id] = newSession;
            newSessionOrder.push(newSession.id);
            newActiveId = newSession.id;

            // 为新创建的空会话保存（空的）消息
            await get().saveSessionMessages(newSession);
          } else {
            // 选择下一个会话作为活跃会话
            if (sessionOrderIndex >= 0) {
              if (sessionOrderIndex < newSessionOrder.length) {
                // 选择同一位置的下一个会话
                newActiveId = newSessionOrder[sessionOrderIndex];
              } else if (newSessionOrder.length > 0) {
                // 选择最后一个会话
                newActiveId = newSessionOrder[newSessionOrder.length - 1];
              }
            } else if (newSessionOrder.length > 0) {
              // 选择第一个会话
              newActiveId = newSessionOrder[0];
            }
          }
        }

        // 立即更新UI状态
        set(() => ({
          sessionsRecord: newSessionsRecord,
          sessionOrder: newSessionOrder,
          activeId: newActiveId,
        }));

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.deleteMessages(sessionId),
              chatInputStorage.deleteChatInput(sessionId),
              systemMessageStorage.deleteSystemMessage(sessionId),
            ]);
            console.log(`[DeleteSession] 已删除会话 ${sessionId} 的所有数据`);
          } catch (error) {
            console.error(
              `[DeleteSession] 删除会话 ${sessionId} 的数据失败:`,
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
          await get().loadSessionMessages(sessionId);

          console.log(`[DeleteSession] 已撤销删除会话 ${sessionId}`);
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
        const { activeId, sessionsRecord, sessionOrder } = get();

        // 如果有 activeId，从 sessionsRecord 中获取
        if (activeId && sessionsRecord[activeId]) {
          return sessionsRecord[activeId];
        }

        // 回退到 sessionOrder 中第一个会话
        if (sessionOrder.length > 0) {
          const firstSessionId = sessionOrder[0];
          const firstSession = sessionsRecord[firstSessionId];
          if (firstSession) {
            // 更新 activeId 为第一个会话的 ID
            set(() => ({ activeId: firstSessionId }));
            return firstSession;
          } else {
            // sessionOrder 中的 ID 在 sessionsRecord 中不存在，清理无效数据
            console.warn(
              "[Store] Found invalid session ID in sessionOrder, cleaning up",
            );
            const validSessionIds = sessionOrder.filter(
              (id) => sessionsRecord[id],
            );
            if (validSessionIds.length > 0) {
              const firstValidId = validSessionIds[0];
              set(() => ({
                sessionOrder: validSessionIds,
                activeId: firstValidId,
              }));
              return sessionsRecord[firstValidId];
            }
          }
        }

        // 作为最后的手段才创建新会话
        console.log(
          "[Store] No valid sessions found, creating new session as last resort",
        );
        const newSession = createEmptySession();
        set((state) => ({
          sessionsRecord: {
            ...state.sessionsRecord,
            [newSession.id]: newSession,
          },
          sessionOrder: [newSession.id],
          activeId: newSession.id,
        }));
        return newSession;
      },

      onNewMessage(
        message: ChatMessage,
        targetSession: ChatSession,
        usage?: any,
      ) {
        get().updateTargetSession(targetSession, (session) => {
          session.lastUpdate = Date.now();
        });
        get().summarizeSession(false, targetSession);
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
      ) {
        const session = get().currentSession();

        // 确保消息已加载
        if (!session.messages || session.messages.length === 0) {
          await get().loadSessionMessages(session.id);
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

        // 立即保存消息到独立存储
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
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
              updateSessionStats(session);
            });
            // 异步保存消息更新
            get().saveSessionMessages(session);
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
              updateSessionStats(session);
            });
            // 异步保存消息更新
            get().saveSessionMessages(session);
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
            // 保存最终消息状态
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
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
              updateSessionStats(session);
            });
            // 保存错误状态的消息
            get().saveSessionMessages(session);
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
          await get().loadSessionMessages(session.id);
          // 重新获取会话以确保得到最新的消息数据
          const updatedSession = get().currentSession();
          return await prepareMessagesForApi(
            updatedSession,
            systemMessageStorage,
          );
        }
        // get() 会获取最新状态，此时 messages 应该已加载
        return await prepareMessagesForApi(session, systemMessageStorage);
      },

      async updateMessage(
        sessionId: string,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const { sessionsRecord } = get();
        const session = sessionsRecord[sessionId];
        if (!session) return;

        const messages = session?.messages;
        updater(messages?.at(messageIndex));

        if (session) {
          updateSessionStats(session);
          await get().saveSessionMessages(session);
          // 更新 sessionsRecord 中的会话
          set((state) => ({
            sessionsRecord: { ...state.sessionsRecord, [sessionId]: session },
          }));
        }
      },

      async resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          updateSessionStats(session);
        });
        await get().saveSessionMessages(session);
      },

      async summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        await summarizeSession(targetSession, refreshTitle, (newTopic) => {
          get().updateTargetSession(targetSession, (session) => {
            session.title = newTopic;
          });
        });
      },

      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const { sessionsRecord } = get();
        const sessionToUpdate = sessionsRecord[targetSession.id];
        if (!sessionToUpdate) return;

        // 更新会话
        updater(sessionToUpdate);

        // 同步更新 sessionsRecord 中的会话
        const updatedSessionsRecord = { ...sessionsRecord };
        updatedSessionsRecord[targetSession.id] = sessionToUpdate;

        set(() => ({
          sessionsRecord: updatedSessionsRecord,
        }));
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
    version: 5.3,
    storage: jchatStorage,

    /**
     * **核心改动：在数据恢复后加载当前会话的消息**
     * 这个钩子在状态从 storage 成功恢复（rehydrated）后触发
     */
    onRehydrateStorage: () => {
      return (hydratedState, error) => {
        if (error) {
          console.error("[Store] An error happened during hydration", error);
          return;
        }

        // **关键修复：验证恢复的状态数据**
        if (!hydratedState) {
          console.warn("[Store] Hydrated state is null, using default state");
          return;
        }

        console.log(
          "[Store] Hydration finished, sessions count:",
          Object.keys(hydratedState.sessionsRecord || {}).length,
        );

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
          // **优化：使用 requestAnimationFrame 确保 DOM 更新完成后再执行**
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                const state = useChatStore.getState();
                const { activeId, sessionOrder, sessionsRecord } = state;

                console.log("[Store] Post-hydration state check:", {
                  activeId,
                  sessionOrderLength: sessionOrder.length,
                  sessionsCount: Object.keys(sessionsRecord).length,
                });

                // 如果有 activeId，加载对应会话的消息
                if (activeId && sessionsRecord[activeId]) {
                  state.loadSessionMessages(activeId);
                }
                // 如果没有 activeId 但有会话，选择第一个会话
                else if (sessionOrder.length > 0) {
                  const firstSessionId = sessionOrder[0];
                  if (sessionsRecord[firstSessionId]) {
                    state.selectSession(firstSessionId);
                  }
                }
              } catch (error) {
                console.error("[Store] Error in post-hydration setup:", error);
              }
            }, 50); // 减少延迟时间，但保持异步执行
          });
        }
      };
    },

    migrate(persistedState: any, version: number) {
      return persistedState;

      console.log("[Store] migrate", version, persistedState);

      // **安全修复：即使数据为 null/undefined，也不直接重置，而是尝试保留现有状态**
      if (!persistedState || typeof persistedState !== "object") {
        console.warn(
          "[Store] persistedState is null/undefined, but will use default state to avoid data loss",
        );
        // 为了避免循环依赖和类型问题，我们使用默认状态，但会在 onRehydrateStorage 中尝试恢复
        return DEFAULT_CHAT_STATE;
      }

      if (version === 5.2) {
        // 处理从 5.2 升级的情况
        if (Array.isArray(persistedState.sessions)) {
          const sessions = persistedState.sessions;
          const sessionsRecord: Record<string, any> = {};
          const sessionOrder: string[] = [];

          sessions.forEach((session: any) => {
            if (session && session.id) {
              sessionsRecord[session.id] = session;
              sessionOrder.push(session.id);
            }
          });

          console.log(
            "[Store] Migrated from 5.2, sessions count:",
            sessions.length,
          );
          return {
            ...persistedState,
            sessionsRecord,
            sessionOrder,
            activeId: sessionOrder[0] || null,
          };
        }
      }

      // 对于未知版本，更安全地保留数据
      console.warn("[Store] Unknown version, attempting to preserve all data");
      const fallbackState = {
        ...DEFAULT_CHAT_STATE,
        ...persistedState,
      };

      // 更安全地处理数据结构，尽量保留原有数据
      if (
        !fallbackState.sessionsRecord ||
        typeof fallbackState.sessionsRecord !== "object"
      ) {
        console.warn(
          "[Store] Preserving sessionsRecord as-is or using empty object",
        );
        fallbackState.sessionsRecord = fallbackState.sessionsRecord || {};
      }
      if (!Array.isArray(fallbackState.sessionOrder)) {
        console.warn("[Store] Rebuilding sessionOrder from available data");
        fallbackState.sessionOrder = Object.keys(
          fallbackState.sessionsRecord || {},
        );
      }

      return fallbackState;
    },
  },
);
