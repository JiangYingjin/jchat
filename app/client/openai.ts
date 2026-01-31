"use client";

import { ApiPath, OpenaiPath } from "@/app/constant";
import { useChatStore } from "@/app/store";
import { convertImageUrlsToBase64, stream } from "@/app/utils/chat";
import { ChatOptions, getHeaders, LLMApi, MultimodalContent } from "./api";

export interface RequestPayload {
  messages: {
    role: "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  model: string;
  max_tokens?: number;
  mem0_user_id?: string;
}

export class OpenAIApi implements LLMApi {
  async chat(options: ChatOptions) {
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      // 1. 并行处理消息中的图片，将图片 URL 转换为 base64
      const messages = await Promise.all(
        options.messages.map(async (v) => ({
          role: v.role,
          content:
            typeof v.content === "string"
              ? v.content
              : await convertImageUrlsToBase64(v.content),
        })),
      );

      // 2. 构建请求体
      const requestPayload: RequestPayload = {
        messages,
        model: options.model || useChatStore.getState().currentSession().model,
        max_tokens: 8000,
        stream: true,
      };
      const mem0Id = options.mem0_user_id?.trim();
      if (mem0Id) requestPayload.mem0_user_id = mem0Id;
      console.log("[Request] openai payload: ", requestPayload);

      const chatPath = this.path(OpenaiPath.ChatPath);
      const headers = getHeaders();

      const extractStreamData = (text: string) => {
        const delta = JSON.parse(text).choices?.[0]?.delta;
        const fallbackResp = { content: "", isReasoning: false };
        if (!delta) return fallbackResp;

        const reasoning = delta.reasoning_content || delta.reasoning;
        const content = delta.content;

        if (reasoning) return { content: reasoning, isReasoning: true };
        else if (content) return { content: content, isReasoning: false };
        else return fallbackResp;
      };

      // 流式请求逻辑
      stream(
        chatPath,
        requestPayload,
        headers,
        controller,
        extractStreamData,
        options,
      );
    } catch (e) {
      console.error("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  path(path: string): string {
    const apiPath = ApiPath.OpenAI as string; // "/api/openai"
    let baseUrl: string;

    // 客户端环境：使用当前域名构建完整URL
    if (typeof window !== "undefined")
      baseUrl = `${window.location.protocol}//${window.location.host}${apiPath}`;
    // 服务端环境：使用相对路径
    else baseUrl = apiPath;

    // console.log("[Proxy Endpoint] ", baseUrl, path);
    return `${baseUrl}/${path}`;
  }

  extractMessage(res: any): string {
    return res.choices?.at(0)?.message?.content ?? "";
  }
}

export { OpenaiPath };
