"use client";

import { ApiPath, OpenaiPath } from "@/app/constant";
import { useChatStore } from "@/app/store";
import { preProcessImageContent, streamWithThink } from "@/app/utils/chat";
import { ChatOptions, getHeaders, LLMApi, MultimodalContent } from "./api";
import { getTimeoutMSByModel } from "@/app/utils";

export interface RequestPayload {
  messages: {
    role: "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  model: string;
  max_tokens?: number;
}

export class OpenAIApi implements LLMApi {
  path(path: string): string {
    const apiPath = ApiPath.OpenAI as string; // "/api/openai"
    let baseUrl: string;

    if (typeof window !== "undefined") {
      // 客户端环境：使用当前域名构建完整URL
      baseUrl = `${window.location.protocol}//${window.location.host}${apiPath}`;
    } else {
      // 服务端环境：使用相对路径
      baseUrl = apiPath;
    }

    // console.log("[Proxy Endpoint] ", baseUrl, path);
    return `${baseUrl}/${path}`;
  }

  extractMessage(res: any): string {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  async chat(options: ChatOptions) {
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      // 1. 并行处理消息中的图片
      const messages = await Promise.all(
        options.messages.map(async (v) => ({
          role: v.role,
          content:
            typeof v.content === "string"
              ? v.content
              : await preProcessImageContent(v.content),
        })),
      );

      // 2. 构建请求体
      const requestPayload: RequestPayload = {
        messages,
        stream: options.config.stream,
        model:
          options.config.model ||
          useChatStore.getState().currentSession().model,
        max_tokens: 8000, // 保持硬编码的 max_tokens
      };

      console.log("[Request] openai payload: ", requestPayload);

      const chatPath = this.path(OpenaiPath.ChatPath);
      const headers = getHeaders();
      const shouldStream = !!options.config.stream;

      if (shouldStream) {
        // 3. 流式请求逻辑
        streamWithThink(
          chatPath,
          requestPayload,
          headers,
          controller,
          // 简化的 SSE 解析逻辑
          (text: string) => {
            const json = JSON.parse(text);
            const delta = json.choices?.[0]?.delta;
            if (!delta) return { isThinking: false, content: "" };

            const reasoning = delta.reasoning_content || delta.reasoning;
            const content = delta.content;

            if (reasoning) {
              return { isThinking: true, content: reasoning };
            }
            if (content) {
              return { isThinking: false, content: content };
            }
            return { isThinking: false, content: "" };
          },
          options,
        );
      } else {
        // 4. 非流式请求逻辑
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await fetch(chatPath, {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers,
        });
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson); // 移除了不必要的 await
        options.onFinish(message, res, resJson.usage);
      }
    } catch (e) {
      console.error("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
}

export { OpenaiPath };
