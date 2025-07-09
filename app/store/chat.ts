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
      forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        newSession.messages = [...currentSession.messages];
        newSession.model = currentSession.model;
        newSession.isModelManuallySelected =
          currentSession.isModelManuallySelected;

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
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

      newSession() {
        const session = createEmptySession();
        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      // 分支会话：创建一个包含指定消息历史的新会话
      branchSession(
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

        const currentIndex = get().currentSessionIndex;

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionIndex: currentIndex + 1,
        }));

        return newSession;
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        // 删除对应的聊天输入数据和系统消息数据
        const deleteSessionData = async () => {
          try {
            await chatInputStorage.deleteChatInput(deletedSession.id);
            await systemMessageStorage.deleteSystemMessage(deletedSession.id);
            console.log(
              `[DeleteSession] 已删除会话 ${deletedSession.id} 的聊天输入数据和系统消息数据`,
            );
          } catch (error) {
            console.error(
              `[DeleteSession] 删除会话 ${deletedSession.id} 的数据失败:`,
              error,
            );
          }
        };
        deleteSessionData();

        showToast(
          Locale.Chat.DeleteMessageToast,
          {
            text: Locale.Chat.Revert,
            onClick() {
              set(() => restoreState);
            },
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
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
          updateSessionStats(session);
        });
        get().summarizeSession(false, targetSession);
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
      ) {
        const session = get().currentSession();

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
        return await getMessagesWithMemory(session, systemMessageStorage);
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        if (session) {
          updateSessionStats(session);
        }
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          updateSessionStats(session);
        });
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
    version: 4.3,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      return persistedState as any;
    },
  },
);
