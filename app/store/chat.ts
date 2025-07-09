import type {
  ClientApi,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi, getHeaders } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import { StoreKey } from "../constant";
import Locale from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { chatInputStorage } from "./input";
import { systemMessageStorage } from "./system";
// 导入新的 messageStorage
import { messageStorage } from "./message";

// 导入session工具函数
import {
  createMessage,
  createEmptySession,
  createBranchSession,
  getMessagesWithMemory,
  summarizeSession,
  prepareSendMessages,
  insertMessage,
  calculateMoveIndex,
  validateSessionIndex,
  updateSessionStats,
} from "../utils/session";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

export type ChatMessage = RequestMessage & {
  id: string;
  model?: string;
  date: string;
  streaming?: boolean;
  isError?: boolean;
};

export interface ChatSession {
  id: string;

  topic: string;
  messages: ChatMessage[];
  model: string; // 当前会话选择的模型

  messageCount: number; // 消息数量
  status: "normal" | "error" | "pending"; // 会话状态：正常、错误、用户消息待回复
  lastUpdate: number;

  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
}

const DEFAULT_CHAT_STATE = {
  accessCode: "",
  models: [] as string[],
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
};

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;

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
          const messages = await messageStorage.getMessages(session.id);
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

        newSession.topic = currentSession.topic;
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
          currentSessions.map((session) =>
            messageStorage.deleteMessages(session.id),
          ),
        );

        const newSession = createEmptySession();
        // 为新创建的空会话保存（空的）消息
        await get().saveSessionMessages(newSession);

        set(() => ({
          sessions: [newSession],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
        // 当选择一个新会话时，触发消息加载
        get().loadSessionMessages(index);
      },

      moveSession(from: number, to: number) {
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
      },

      async newSession() {
        const session = createEmptySession();
        // 为新会话保存空的 message 数组
        await get().saveSessionMessages(session);

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
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

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionIndex: 0, // 切换到新创建的分支会话
        }));

        return newSession;
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

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.deleteMessages(deletedSession.id),
              chatInputStorage.deleteChatInput(deletedSession.id),
              systemMessageStorage.deleteSystemMessage(deletedSession.id),
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
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        const validIndex = validateSessionIndex(index, sessions.length);
        if (validIndex !== index) {
          set(() => ({ currentSessionIndex: validIndex }));
          index = validIndex;
        }

        return sessions[index];
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
          await get().loadSessionMessages(get().currentSessionIndex);
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
        let recentMessages = await get().getMessagesWithMemory();
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

      async getMessagesWithMemory() {
        const session = get().currentSession();
        // **核心改动：如果消息未加载，先加载它们**
        if (session && (!session.messages || session.messages.length === 0)) {
          await get().loadSessionMessages(get().currentSessionIndex);
        }
        // get() 会获取最新状态，此时 messages 应该已加载
        return await getMessagesWithMemory(
          get().currentSession(),
          systemMessageStorage,
        );
      },

      async updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        if (!session) return;

        const messages = session?.messages;
        updater(messages?.at(messageIndex));

        if (session) {
          updateSessionStats(session);
          await get().saveSessionMessages(session);
        }
        set(() => ({ sessions }));
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
            session.topic = newTopic;
          });
        });
      },

      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        updater(sessions[index]);
        set(() => ({ sessions }));
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
    version: 4.4, // 增加版本号，因为数据结构发生了变化
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
          console.log("[Store] Hydration finished.");
          // 只在客户端环境下执行消息加载
          if (typeof window !== "undefined") {
            // 确保在状态设置后调用，可以稍微延迟执行
            setTimeout(() => {
              const { currentSessionIndex } = useChatStore.getState();
              useChatStore.getState().loadSessionMessages(currentSessionIndex);
            }, 0);
          }
        }
      };
    },

    migrate(persistedState: any, version: number) {
      // 在这里处理旧版本数据的迁移逻辑
      // 例如，从 v4.3 升级到 v4.4，我们需要将旧的 messages 提取到 messageStorage
      if (version < 4.4 && persistedState && persistedState.sessions) {
        console.log("[Migrate] Migrating chat store from v4.3 to v4.4");
        // 只在客户端环境下进行消息迁移
        if (typeof window !== "undefined") {
          persistedState.sessions.forEach((session: any) => {
            if (session.messages && Array.isArray(session.messages)) {
              console.log(
                `[Migrate] Moving messages for session ${session.id}`,
              );
              // 异步保存消息，无需等待完成
              messageStorage.saveMessages(session.id, session.messages);
              // 从会话对象中删除消息，尽管 partialize 会处理，但在这里清理更干净
              session.messages = [];
            }
          });
        }
      }
      return persistedState as any;
    },
  },
);
