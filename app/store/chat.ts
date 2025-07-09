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
import localforage from "localforage";

// 导入session工具函数
import {
  createMessage,
  createEmptySession,
  createBranchSession,
  getMessagesWithMemory,
  summarizeSession,
  updateSessionStat,
  prepareSendMessages,
  insertMessage,
  calculateMoveIndex,
  validateSessionIndex,
} from "../utils/session";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

export type ChatMessage = RequestMessage & {
  id: string;
  model?: string;
  date: string;
  streaming?: boolean;
  isError?: boolean;
};

export interface ChatStat {
  tokenCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;
  messages: ChatMessage[];
  model: string; // 当前会话选择的模型
  stat: ChatStat;
  lastUpdate: number;
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
}

const DEFAULT_CHAT_STATE = {
  accessCode: "",
  models: [],
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
        });
        get().updateStat(message, targetSession, usage);
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
            });
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
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
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
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

      updateStat(message: ChatMessage, session: ChatSession, usage?: any) {
        get().updateTargetSession(session, (session) => {
          const statUpdates = updateSessionStat(message, session, usage);
          Object.assign(session.stat, statUpdates);
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
    version: 4.2,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      // 版本 4.0: 移除 ChatSession 中的 mask 属性
      if (version < 4.0) {
        if (persistedState.sessions) {
          persistedState.sessions.forEach((session: any) => {
            if (session.mask !== undefined) {
              delete session.mask;
            }
          });
        }
      }

      // 版本 4.1: 添加 accessCode 属性
      if (version < 4.1) {
        if (persistedState.accessCode === undefined) {
          persistedState.accessCode = "";
        }
      }

      // 版本 4.2: 添加 models 属性
      if (version < 4.2) {
        if (persistedState.models === undefined) {
          persistedState.models = "";
        }
      }

      return persistedState as any;
    },
  },
);

// 系统消息数据存储接口
interface SystemMessageData {
  text: string;
  images: string[];
  scrollTop: number;
  selection: { start: number; end: number };
  updateAt: number;
}

// 使用 localforage 存储系统消息
class SystemMessageStorage {
  private storage: LocalForage;

  constructor() {
    this.storage = localforage.createInstance({
      name: "JChat",
      storeName: "systemMessages",
      description: "System messages storage",
    });
  }

  async saveSystemMessage(
    sessionId: string,
    data: SystemMessageData,
  ): Promise<boolean> {
    try {
      await this.storage.setItem(sessionId, data);
      return true;
    } catch (error) {
      console.error("保存系统消息失败:", error);
      return false;
    }
  }

  async getSystemMessage(sessionId: string): Promise<SystemMessageData | null> {
    try {
      const data = await this.storage.getItem<SystemMessageData>(sessionId);
      return data || null;
    } catch (error) {
      console.error("获取系统消息失败:", error);
      return null;
    }
  }

  async deleteSystemMessage(sessionId: string): Promise<boolean> {
    try {
      await this.storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error("删除系统消息失败:", error);
      return false;
    }
  }

  // 验证系统消息是否存在且有效
  async validateSystemMessage(sessionId: string): Promise<boolean> {
    try {
      const data = await this.getSystemMessage(sessionId);
      return (
        data !== null && (data.text.trim() !== "" || data.images.length > 0)
      );
    } catch (error) {
      console.error(`验证系统消息失败 (${sessionId}):`, error);
      return false;
    }
  }

  // 批量验证系统消息
  async validateAllSystemMessages(
    sessionIds: string[],
  ): Promise<{ valid: string[]; invalid: string[] }> {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const sessionId of sessionIds) {
      const isValid = await this.validateSystemMessage(sessionId);
      if (isValid) {
        valid.push(sessionId);
      } else {
        invalid.push(sessionId);
      }
    }

    return { valid, invalid };
  }

  // 获取所有会话ID
  async getAllSessionIds(): Promise<string[]> {
    try {
      const keys = await this.storage.keys();
      return keys;
    } catch (error) {
      console.error("获取所有会话ID失败:", error);
      return [];
    }
  }
}

// 创建全局实例
export const systemMessageStorage = new SystemMessageStorage();

// 聊天输入数据存储接口
interface ChatInputData {
  text: string;
  images: string[];
  scrollTop: number;
  selection: { start: number; end: number };
  updateAt: number;
}

// 使用 localforage 存储聊天输入数据
class ChatInputStorage {
  private storage: LocalForage;

  constructor() {
    this.storage = localforage.createInstance({
      name: "JChat",
      storeName: "chatInput",
      description: "Chat input storage",
    });
  }

  async saveChatInput(
    sessionId: string,
    data: ChatInputData,
  ): Promise<boolean> {
    try {
      await this.storage.setItem(sessionId, data);
      return true;
    } catch (error) {
      console.error("保存聊天输入失败:", error);
      return false;
    }
  }

  async getChatInput(sessionId: string): Promise<ChatInputData | null> {
    try {
      const data = await this.storage.getItem<ChatInputData>(sessionId);
      return data || null;
    } catch (error) {
      console.error("获取聊天输入失败:", error);
      return null;
    }
  }

  async deleteChatInput(sessionId: string): Promise<boolean> {
    try {
      await this.storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error("删除聊天输入失败:", error);
      return false;
    }
  }

  // 获取所有会话ID
  async getAllSessionIds(): Promise<string[]> {
    try {
      const keys = await this.storage.keys();
      return keys;
    } catch (error) {
      console.error("获取所有会话ID失败:", error);
      return [];
    }
  }
}

// 创建全局实例
export const chatInputStorage = new ChatInputStorage();
