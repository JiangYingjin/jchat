"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  DEFAULT_MODELS,
  OpenaiPath,
  REQUEST_TIMEOUT_MS,
  OPENAI_BASE_URL,
} from "@/app/constant";
import { useAccessStore, useAppConfig, useChatStore } from "@/app/store";
import { getModelList } from "@/app/utils/model";
import {
  preProcessImageAndWebReferenceContent,
  streamWithThink,
} from "@/app/utils/chat";

import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  MultimodalContent,
} from "../api";
import Locale from "../../locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { getClientConfig } from "@/app/config/client";
import { getMessageTextContent, getTimeoutMSByModel } from "@/app/utils";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

export interface RequestPayload {
  messages: {
    role: "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  model: string;
  temperature: number;
  max_tokens?: number;
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = false;

  path(path: string, model?: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = accessStore.openaiUrl;
    if (!baseUrl || baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.OpenAI)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };

    let requestPayload: // | RequestPayload
    // | DalleRequestPayload
    // | GPTImageRequestPayload
    RequestPayload;

    const isOseries =
      options.config.model.startsWith("o1") ||
      options.config.model.startsWith("o3") ||
      options.config.model.startsWith("o4");

    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = await preProcessImageAndWebReferenceContent(v);
      if (!(isOseries && v.role === "system"))
        messages.push({ role: v.role, content });
    }

    // O1 support image, tools (except o4-mini for now) and system, stream, *NOT* logprobs, temperature, top_p, n yet.
    requestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      temperature: !isOseries ? modelConfig.temperature : 1,
      // max_tokens: Math.max(modelConfig.max_tokens, 1024),
      // Please do not ask me why not send max_tokens, no reason, this param is just shit, I dont want to explain anymore.
    };

    requestPayload["max_tokens"] = modelConfig.max_tokens;

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(OpenaiPath.ChatPath);
      if (shouldStream) {
        let index = -1;
        const tools = null;
        const funcs: Record<string, Function> = {};
        // console.log("getAsTools", tools, funcs);
        streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: any[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: any[];
                reasoning_content: string | null;
                reasoning: string | null;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                index += 1;
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }

            const reasoning =
              choices[0]?.delta?.reasoning_content ||
              choices[0]?.delta?.reasoning;
            const content = choices[0]?.delta?.content;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // reset index value
            index = -1;
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: getHeaders(),
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = await this.extractMessage(resJson);
        const usage = resJson.usage;
        options.onFinish(message, res, usage);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  async models(): Promise<LLMModel[]> {
    // 获取服务器端配置的模型列表
    const accessStore = useAccessStore.getState();
    const configStore = useAppConfig.getState();

    // 使用 getModelList 来获取完整的模型列表
    const allModels = getModelList(
      accessStore.customModels,
      accessStore.defaultModel,
    );

    return allModels;
  }
}
export { OpenaiPath };
