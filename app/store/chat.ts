import {
  getMessageTextContent,
  getTextContent,
  isFunctionCallModel,
  trimTopic,
} from "../utils";

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
  ServiceProvider,
} from "../constant";
import Locale, { getLang, Lang } from "../locales";
import { safeLocalStorage } from "../utils";
import { prettyObject } from "../utils/format";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { useAccessStore } from "./access";
import { collectModelsWithDefaultModel } from "../utils/model";

import { FileInfo, WebApi } from "../client/platforms/utils";
import { usePluginStore } from "./plugin";
import { TavilySearchResponse } from "@tavily/core";

import { buildMultimodalContent } from "../utils/chat";

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
  usePlugins?: boolean;
  webSearch?: boolean;
  claudeThinking?: boolean;
  // 上游插件业务参数
  plugin?: string[];
  enableArtifacts?: boolean;
  enableCodeFold?: boolean;
};

export interface ChatToolMessage {
  toolName: string;
  toolInput?: string;
}

const localStorage = safeLocalStorage();

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  date: string;
  toolMessages?: ChatToolMessage[];
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audioUrl?: string;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    toolMessages: new Array<ChatToolMessage>(),
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
    usePlugins: /^gpt(?!.*03\d{2}$).*$/.test(config.modelConfig.model),
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
    return [SUMMARIZE_MODEL, ServiceProvider.OpenAI];
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
  lastInput: "",
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
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
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
        webSearchReference?: TavilySearchResponse,
        messageIdx?: number,
      ) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const accessStore = useAccessStore.getState();

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
          webSearchReferences: webSearchReference,
        });

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          toolMessages: [],
        });
        const isEnableRAG =
          session.attachFiles && session.attachFiles.length > 0;
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

        const config = useAppConfig.getState();
        const pluginConfig = useAppConfig.getState().pluginConfig;
        const pluginStore = usePluginStore.getState();
        const allPlugins = pluginStore
          .getAll()
          .filter(
            (m) =>
              (!getLang() ||
                m.lang === (getLang() == "cn" ? getLang() : "en")) &&
              m.enable,
          );
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

        const api: ClientApi = getClientApi(modelConfig.providerName);
        if (
          config.pluginConfig.enable &&
          session.mask.usePlugins &&
          (allPlugins.length > 0 || isEnableRAG) &&
          isFunctionCallModel(modelConfig.model)
        ) {
          console.log("[ToolAgent] start");
          let pluginToolNames = allPlugins.map((m) => m.toolName);
          if (isEnableRAG) {
            // other plugins will affect rag
            // clear existing plugins here
            pluginToolNames = [];
            pluginToolNames.push("myfiles_browser");
          }
          const agentCall = () => {
            api.llm.toolAgentChat({
              chatSessionId: session.id,
              messages: sendMessages,
              config: { ...modelConfig, stream: true },
              agentConfig: { ...pluginConfig, useTools: pluginToolNames },
              onUpdate(message) {
                botMessage.streaming = true;
                if (message) {
                  botMessage.content = message;
                }
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                });
              },
              onToolUpdate(toolName, toolInput) {
                botMessage.streaming = true;
                if (toolName && toolInput) {
                  botMessage.toolMessages!.push({
                    toolName,
                    toolInput,
                  });
                }
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                });
              },
              onFinish(message) {
                botMessage.streaming = false;
                if (message) {
                  botMessage.content = message;
                  get().onNewMessage(botMessage, session);
                }
                ChatControllerPool.remove(session.id, botMessage.id);
              },
              onError(error) {
                const isAborted = error.message.includes("aborted");
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
          };
          agentCall();
        } else {
          if (session.mask.webSearch && accessStore.enableWebSearch()) {
            botMessage.content = Locale.Chat.Searching;
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
            });
            const webApi = new WebApi();
            const webSearchReference = await webApi.search(content);
            userMessage.webSearchReferences = webSearchReference;
            botMessage.webSearchReferences = webSearchReference;
          }
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
            onBeforeTool(tool: ChatMessageTool) {
              (botMessage.tools = botMessage?.tools || []).push(tool);
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            onAfterTool(tool: ChatMessageTool) {
              botMessage?.tools?.forEach((t, i, tools) => {
                if (tool.id == t.id) {
                  tools[i] = { ...tool };
                }
              });
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
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
        }
      },

      getMemoryPrompt() {
        // 移除历史摘要功能，始终返回 undefined
        return undefined;
      },

      async getMessagesWithMemory() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
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
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        // skip summarize when using dalle3?
        if (false) {
          return;
        }

        // if not config compressModel, then using getSummarizeModel
        const [model, providerName] = modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );

        const api: ClientApi = getClientApi(providerName as ServiceProvider);

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          (!process.env.NEXT_PUBLIC_DISABLE_AUTOGENERATETITLE &&
            config.enableAutoGenerateTitle &&
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

        // 历史消息总结功能已被禁用，不再执行相关逻辑
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
      async clearAllData() {
        localStorage.clear();

        // 清理所有聊天输入数据和系统消息数据
        try {
          const sessionIds = await chatInputStorage.getAllSessionIds();
          for (const sessionId of sessionIds) {
            await chatInputStorage.deleteChatInput(sessionId);
            await systemMessageStorage.deleteSystemMessage(sessionId);
          }
          console.log(
            `[ClearAllData] 已清理 ${sessionIds.length} 个会话的聊天输入数据和系统消息数据`,
          );
        } catch (error) {
          console.error("[ClearAllData] 清理数据失败:", error);
        }

        location.reload();
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.4,
    async migrate(persistedState, version) {
      const state = persistedState as any;
      const newState = JSON.parse(
        JSON.stringify(state),
      ) as typeof DEFAULT_CHAT_STATE;

      if (version < 2) {
        newState.sessions = [];

        const oldSessions = state.sessions;
        for (const oldSession of oldSessions) {
          const newSession = createEmptySession();
          newSession.topic = oldSession.topic;
          newSession.messages = [...oldSession.messages];
          newSession.mask.modelConfig.sendMemory = true;
          newState.sessions.push(newSession);
        }
      }

      if (version < 3) {
        // migrate id to nanoid
        newState.sessions.forEach((s) => {
          s.id = nanoid();
          s.messages.forEach((m) => (m.id = nanoid()));
        });
      }

      // add default summarize model for every session
      if (version < 3.2) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = config.modelConfig.compressModel;
          s.mask.modelConfig.compressProviderName =
            config.modelConfig.compressProviderName;
        });
      }

      return newState as any;
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

// 使用 IndexedDB 存储系统消息
class SystemMessageStorage {
  private dbName = "JChat";
  private version = 3; // 升级版本以支持新的数据格式
  private storeName = "systemMessages";

  async initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // 确保 systemMessages 表存在
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "sessionId" });
        }
        // 确保 chatInput 表存在
        if (!db.objectStoreNames.contains("chatInput")) {
          db.createObjectStore("chatInput", { keyPath: "sessionId" });
        }
      };
    });
  }

  async saveSystemMessage(
    sessionId: string,
    data: SystemMessageData,
  ): Promise<boolean> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const saveData = {
        sessionId,
        ...data,
      };
      await new Promise((resolve, reject) => {
        const request = store.put(saveData);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return true;
    } catch (error) {
      console.error("保存系统消息到 JChat.systemMessages 失败:", error);
      return false;
    }
  }

  async getSystemMessage(sessionId: string): Promise<SystemMessageData | null> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            resolve({
              text: result.text || "",
              images: result.images || [],
              scrollTop: result.scrollTop || 0,
              selection: result.selection || { start: 0, end: 0 },
              updateAt: result.updateAt || Date.now(),
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("从 JChat.systemMessages 读取系统消息失败:", error);
      return null;
    }
  }

  // 兼容旧格式的方法
  async getSystemMessageLegacy(sessionId: string): Promise<string | null> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            // 如果是新格式，返回 text 字段
            if (result.text !== undefined) {
              resolve(result.text);
            } else {
              // 如果是旧格式，返回 content 字段
              resolve(result.content || null);
            }
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("从 JChat.systemMessages 读取系统消息失败:", error);
      return null;
    }
  }

  async deleteSystemMessage(sessionId: string): Promise<boolean> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      await new Promise((resolve, reject) => {
        const request = store.delete(sessionId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return true;
    } catch (error) {
      console.error("从 JChat.systemMessages 删除系统消息失败:", error);
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
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      return new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => {
          const keys = request.result as string[];
          resolve(keys);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("从 JChat.systemMessages 获取所有会话ID失败:", error);
      return [];
    }
  }

  // 迁移旧格式数据到新格式
  async migrateOldFormatData(): Promise<number> {
    try {
      const sessionIds = await this.getAllSessionIds();
      let migratedCount = 0;

      for (const sessionId of sessionIds) {
        const oldData = await this.getSystemMessageLegacy(sessionId);
        if (oldData) {
          // 尝试解析旧格式数据
          let text = "";
          let images: string[] = [];

          try {
            const parsedData = JSON.parse(oldData);
            if (typeof parsedData === "object") {
              if (parsedData.content !== undefined) {
                text = parsedData.content;
              }
              if (
                parsedData.images !== undefined &&
                Array.isArray(parsedData.images)
              ) {
                images = parsedData.images;
              }
            }
          } catch (e) {
            // 如果解析失败，说明是纯文本
            text = oldData;
          }

          // 保存为新格式
          await this.saveSystemMessage(sessionId, {
            text,
            images,
            scrollTop: 0,
            selection: { start: 0, end: 0 },
            updateAt: Date.now(),
          });
          migratedCount++;
        }
      }

      return migratedCount;
    } catch (error) {
      console.error("迁移旧格式系统消息数据失败:", error);
      return 0;
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

// 使用 IndexedDB 存储聊天输入数据
class ChatInputStorage {
  private dbName = "JChat";
  private version = 2; // 升级版本以添加新的存储表
  private storeName = "chatInput";

  async initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // 创建 chatInput 存储表
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "sessionId" });
        }
      };
    });
  }

  async saveChatInput(
    sessionId: string,
    data: ChatInputData,
  ): Promise<boolean> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const saveData = {
        sessionId,
        ...data,
      };
      await new Promise((resolve, reject) => {
        const request = store.put(saveData);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return true;
    } catch (error) {
      console.error("保存聊天输入到 JChat.chatInput 失败:", error);
      return false;
    }
  }

  async getChatInput(sessionId: string): Promise<ChatInputData | null> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            resolve({
              text: result.text || "",
              images: result.images || [],
              scrollTop: result.scrollTop || 0,
              selection: result.selection || { start: 0, end: 0 },
              updateAt: result.updateAt || Date.now(),
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("从 JChat.chatInput 读取聊天输入失败:", error);
      return null;
    }
  }

  async deleteChatInput(sessionId: string): Promise<boolean> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      await new Promise((resolve, reject) => {
        const request = store.delete(sessionId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return true;
    } catch (error) {
      console.error("从 JChat.chatInput 删除聊天输入失败:", error);
      return false;
    }
  }

  // 获取所有会话ID
  async getAllSessionIds(): Promise<string[]> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      return new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => {
          const keys = request.result as string[];
          resolve(keys);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("获取所有会话ID失败:", error);
      return [];
    }
  }

  // 清理过期的聊天输入数据（可选功能）
  async cleanupExpiredData(expireDays: number = 7): Promise<number> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const expireTime = Date.now() - expireDays * 24 * 60 * 60 * 1000;

      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const allData = request.result as Array<
            ChatInputData & { sessionId: string }
          >;
          let deletedCount = 0;

          allData.forEach((data) => {
            if (data.updateAt < expireTime) {
              store.delete(data.sessionId);
              deletedCount++;
            }
          });

          resolve(deletedCount);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("清理过期聊天输入数据失败:", error);
      return 0;
    }
  }
}

// 创建全局实例
export const chatInputStorage = new ChatInputStorage();
