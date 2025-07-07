import { getMessageTextContent, getTextContent, trimTopic } from "../utils";

import { nanoid } from "nanoid";
import type {
  ClientApi,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  KnowledgeCutOffDate,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import Locale, { getLang, Lang } from "../locales";
import { safeLocalStorage } from "../utils";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { estimateTokenLength } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { useAccessStore } from "./access";
import { collectModelsWithDefaultModel } from "../utils/model";

import { FileInfo } from "../client/platforms/utils";

import { buildMultimodalContent } from "../utils/chat";
import localforage from "localforage";

export type Mask = {
  id: string;
  createdAt: number;
  name: string;
  hideContext?: boolean;
  context: ChatMessage[];
  syncGlobalConfig?: boolean;
  modelConfig: ModelConfig;
  lang: Lang;
  builtin: boolean;
  enableArtifacts?: boolean;
  enableCodeFold?: boolean;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  audioUrl?: string;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string | MultimodalContent[];
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;

  attachFiles: FileInfo[];

  // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  longInputMode?: boolean;

  // 用户是否手动选择了模型（用于自动切换逻辑）
  isModelManuallySelected?: boolean;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;

function createEmptySession(): ChatSession {
  const config = useAppConfig.getState();
  const emptyMask: Mask = {
    id: nanoid(),
    name: DEFAULT_TOPIC,
    context: [],
    syncGlobalConfig: true,
    modelConfig: { ...config.modelConfig },
    lang: getLang(),
    builtin: false,
    createdAt: Date.now(),
  };

  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,
    mask: emptyMask,
    attachFiles: [],
    longInputMode: false, // 默认不是长输入模式
    isModelManuallySelected: false, // 默认用户没有手动选择模型
  };
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  // if it is using gpt-* models, force to use 4o-mini to summarize
  if (currentModel.startsWith("gpt") || currentModel.startsWith("chatgpt")) {
    const configStore = useAppConfig.getState();
    const accessStore = useAccessStore.getState();
    const allModel = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const summarizeModel = allModel.find(
      (m) => m.name === SUMMARIZE_MODEL && m.available,
    );
    if (summarizeModel) {
      return [
        summarizeModel.name,
        summarizeModel.provider?.providerName as string,
      ];
    }
  }
  if (currentModel.startsWith("gemini")) {
    return [SUMMARIZE_MODEL, "OpenAI"];
  }
  return [currentModel, providerName];
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const modelInfo = DEFAULT_MODELS.find((m) => m.name === modelConfig.model);

  var serviceProvider = "OpenAI";
  if (modelInfo) {
    // TODO: auto detect the providerName from the modelConfig.model

    // Directly use the providerName from the modelInfo
    serviceProvider = modelInfo.provider.providerName;
  }

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        newSession.messages = [...currentSession.messages];
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };
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

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
          // 使用 mask 创建会话时，如果 mask 有特定的模型配置，则认为是手动选择的
          session.isModelManuallySelected =
            mask.modelConfig.model !== globalModelConfig.model;
        }

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
        // 使用底层方法创建完整的新会话对象
        const newSession = createEmptySession();

        // 设置会话属性
        newSession.topic = branchTopic;
        newSession.messages = [...messagesToCopy];
        newSession.longInputMode = originalSession.longInputMode;
        newSession.isModelManuallySelected =
          originalSession.isModelManuallySelected;

        // 复制模型配置
        newSession.mask.modelConfig = { ...originalSession.mask.modelConfig };
        newSession.mask.syncGlobalConfig =
          originalSession.mask.syncGlobalConfig;
        newSession.mask.context = [...originalSession.mask.context];

        const currentIndex = get().currentSessionIndex;

        // 一次性插入完整的新会话到sessions开头
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

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        get().updateTargetSession(targetSession, (session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });
        get().updateStat(message, targetSession);
        get().summarizeSession(false, targetSession);
      },

      async onUserInput(
        content: string,
        attachImages?: string[],
        attachFiles?: FileInfo[],
        messageIdx?: number,
      ) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;

        const userContent = fillTemplateWith(content, modelConfig);
        console.log("[User Input] after template: ", userContent);

        let mContent: string | MultimodalContent[] = userContent;

        if (attachImages && attachImages.length > 0) {
          mContent = [
            ...(userContent
              ? [{ type: "text" as const, text: userContent }]
              : []),
            ...attachImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        }

        // add file link
        if (attachFiles && attachFiles.length > 0) {
          mContent += ` [${attachFiles[0].originalFilename}](${attachFiles[0].filePath})`;
        }

        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: mContent,
          fileInfos: attachFiles,
        });

        const botMessage = createMessage({
          role: "assistant",
          content: "",
          streaming: true,
          model: modelConfig.model,
        });

        // get recent messages
        let recentMessages = await get().getMessagesWithMemory();
        let sendMessages: ChatMessage[];
        if (typeof messageIdx === "number" && messageIdx >= 0) {
          // 只取到 messageIdx（含）为止的消息
          sendMessages = recentMessages
            .slice(0, messageIdx)
            .concat(userMessage);
        } else {
          sendMessages = recentMessages.concat(userMessage);
        }
        const messageIndex = session.messages.length + 1;

        // save user's and bot's message
        get().updateTargetSession(session, (session) => {
          const savedUserMessage = {
            ...userMessage,
            content: mContent,
          };
          if (typeof messageIdx === "number" && messageIdx >= 0) {
            // 入参 messageIdx，插入到指定位置
            const insertIdx = Math.min(messageIdx, session.messages.length);
            // 要确定 messageIdx+1 位置消息的 role 是否为 assistant
            const nextMessage = session.messages[insertIdx + 1];
            if (nextMessage && nextMessage.role === "assistant") {
              // 如果 nextMessage 是 assistant，则插入到 nextMessage 后面
              session.messages = [
                ...session.messages.slice(0, insertIdx + 1),
                botMessage,
                ...session.messages.slice(insertIdx + 2),
              ];
            } else {
              // 如果 nextMessage 不是 assistant，则插入到 nextMessage 前面
              session.messages = [
                ...session.messages.slice(0, insertIdx + 1),
                botMessage,
                ...session.messages.slice(insertIdx + 1),
              ];
            }
          } else {
            // 没有入参 messageIdx，插入到末尾
            session.messages = session.messages.concat([
              savedUserMessage,
              botMessage,
            ]);
          }
        });

        const api: ClientApi = getClientApi("OpenAI");
        // make request
        api.llm.chat({
          messages: sendMessages,
          config: { ...modelConfig, stream: true },
          onUpdate(message) {
            botMessage.streaming = true;
            if (message) {
              botMessage.content = message;
            }
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
            });
          },
          onReasoningUpdate(message) {
            botMessage.streaming = true;
            if (message) {
              botMessage.reasoningContent = message;
            }
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
            });
          },
          onFinish(message, responseRes) {
            botMessage.streaming = false;
            if (message) {
              botMessage.content = message;
              botMessage.date = new Date().toLocaleString();
              if (responseRes && responseRes.status !== 200) {
                botMessage.isError = true;
              }
              get().onNewMessage(botMessage, session);
            }
            ChatControllerPool.remove(session.id, botMessage.id);
          },

          onError(error) {
            const isAborted = error.message?.includes?.("aborted");
            botMessage.content +=
              "\n\n" +
              prettyObject({
                error: true,
                message: error.message,
              });
            botMessage.streaming = false;
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
            });
            ChatControllerPool.remove(
              session.id,
              botMessage.id ?? messageIndex,
            );

            console.error("[Chat] failed ", error);
          },
          onController(controller) {
            // collect controller for stop/retry
            ChatControllerPool.addController(
              session.id,
              botMessage.id ?? messageIndex,
              controller,
            );
          },
        });
      },

      async getMessagesWithMemory() {
        const session = get().currentSession();
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        // in-context prompts
        const contextPrompts = session.mask.context.slice();
        // ========== system message 动态加载 ==========
        let systemMessage: ChatMessage | undefined = messages.find(
          (m) => m.role === "system",
        );
        let systemPrompt: ChatMessage[] = [];
        if (systemMessage) {
          let content = systemMessage.content;
          if (!content && (systemMessage as any).contentKey) {
            // 动态从 IndexedDB 取
            const storedData = await systemMessageStorage.getSystemMessage(
              session.id,
            );
            // 只有当IndexedDB中有内容时才使用，否则跳过该系统消息
            if (
              storedData &&
              (storedData.text.trim() !== "" || storedData.images.length > 0)
            ) {
              // 使用新格式的数据构建 multimodalContent
              const multimodalContent = buildMultimodalContent(
                storedData.text,
                storedData.images,
              );
              content = multimodalContent;
            }
          }
          if (
            content &&
            (typeof content === "string"
              ? content.trim() !== ""
              : content.length > 0)
          ) {
            let multimodalContent: import("../client/api").MultimodalContent[];
            if (typeof content === "string") {
              try {
                const data = JSON.parse(content);
                if (
                  typeof data === "object" &&
                  (data.content !== undefined || data.images !== undefined)
                ) {
                  multimodalContent = buildMultimodalContent(
                    data.content,
                    data.images,
                  );
                } else {
                  multimodalContent = buildMultimodalContent(content, []);
                }
              } catch (e) {
                multimodalContent = buildMultimodalContent(content, []);
              }
            } else {
              multimodalContent = content;
            }
            systemPrompt = [
              {
                ...systemMessage,
                content: multimodalContent,
              },
            ];
          }
        }
        // 移除历史摘要相关逻辑，直接使用 clearContextIndex 作为起始索引
        const recentMessages = messages
          .slice(clearContextIndex)
          .filter((msg) => !msg.isError && msg.role !== "system");
        // 合并所有消息，包含动态加载的 system message
        return [...systemPrompt, ...contextPrompts, ...recentMessages];
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
          // 移除对 memoryPrompt 的清除，因为已禁用总结功能
          // session.memoryPrompt = "";
        });
      },

      async summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;

        // if not config compressModel, then using getSummarizeModel
        const [model, providerName] = modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );

        const api: ClientApi = getClientApi(providerName);

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          (!process.env.NEXT_PUBLIC_DISABLE_AUTOGENERATETITLE &&
            session.topic === DEFAULT_TOPIC &&
            countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
          refreshTitle
        ) {
          const topicMessages = messages.concat(
            createMessage({
              role: "user",
              content: Locale.Store.Prompt.Topic,
            }),
          );
          let topicContent: string | MultimodalContent[] = "";
          api.llm.chat({
            messages: topicMessages,
            config: {
              model,
              stream: true,
              providerName,
            },
            onUpdate(message) {
              if (message) {
                topicContent = message;
              }
            },
            onFinish(message, responseRes) {
              const finalMessage = message || topicContent;
              if (responseRes?.status === 200 && finalMessage) {
                get().updateTargetSession(
                  session,
                  (session) =>
                    (session.topic =
                      finalMessage.length > 0
                        ? trimTopic(getTextContent(finalMessage))
                        : DEFAULT_TOPIC),
                );
              }
            },
          });
        }
        return;
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
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
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.8,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      // 简化 migrate 函数，只做版本兼容性处理
      // 数据迁移改为在应用启动时主动执行，使用 app/utils/migration.ts 并在 app/components/home.tsx 中调用
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
