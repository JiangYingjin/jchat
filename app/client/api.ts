import { useChatStore } from "../store";
import { OpenAIApi } from "./openai";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export type ChatModel = string;

export interface MessageContentItem {
  type: "text" | "image";
  content: string | ImageContent;
}

export interface ImageContent {
  mimeType: string;
  data: string;
}

export interface MultimodalContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
  reasoningContent?: string;
}

export interface ChatOptions {
  messages: RequestMessage[];
  model: string;
  /** 用户标识，非空时请求带 user_id + session_type；仅启用记忆时再带 use_memory */
  user_id?: string;
  session_type?: "chat" | "group";
  use_memory?: boolean;

  onUpdate?: (
    message: string | MultimodalContent[],
    chunk: string,
    usage?: {
      completion_tokens?: number;
      prompt_tokens?: number;
      cost?: number;
    },
  ) => void;
  onReasoningUpdate?: (
    message: string,
    chunk: string,
    usage?: {
      completion_tokens?: number;
      prompt_tokens?: number;
      cost?: number;
    },
  ) => void;
  onFinish: (
    message: string | MultimodalContent[],
    responseRes: Response,
    usage?: {
      completion_tokens?: number;
      prompt_tokens?: number;
      cost?: number;
    },
  ) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
}

export class ClientApi {
  public llm: LLMApi;

  constructor() {
    this.llm = new OpenAIApi();
  }
}

export function getClientApi(): ClientApi {
  return new ClientApi();
}

export function getBearerToken(apiKey: string): string {
  return validString(apiKey) ? `Bearer ${apiKey.trim()}` : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

/** 是否为需使用 overrideApiKey 的专用模型（如 agent） */
export function isDedicatedModel(model: string | undefined): boolean {
  if (!model?.trim()) return false;
  const key = model.includes("/") ? model.split("/")[1] : model;
  return key?.trim() === "agent";
}

export function getHeaders(
  ignoreHeadersOrOption?: boolean | { model?: string },
) {
  const chatStore = useChatStore.getState();
  const option =
    typeof ignoreHeadersOrOption === "object"
      ? ignoreHeadersOrOption
      : undefined;
  const ignoreHeaders =
    typeof ignoreHeadersOrOption === "boolean" ? ignoreHeadersOrOption : false;

  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const useOverride =
    option?.model &&
    isDedicatedModel(option.model) &&
    validString(chatStore.overrideApiKey);
  if (useOverride) {
    headers["Authorization"] = getBearerToken(chatStore.overrideApiKey.trim());
  } else if (validString(chatStore.accessCode)) {
    headers["Authorization"] = getBearerToken(chatStore.accessCode);
  }

  return headers;
}
