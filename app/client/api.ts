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

  onUpdate?: (
    message: string | MultimodalContent[],
    chunk: string,
    usage?: {
      completion_tokens?: number;
      prompt_tokens?: number;
      cost?: number;
    },
  ) => void;
  onReasoningUpdate?: (message: string, chunk: string) => void;
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

export function getHeaders(ignoreHeaders: boolean = false) {
  const chatStore = useChatStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  if (validString(chatStore.accessCode)) {
    headers["Authorization"] = getBearerToken(chatStore.accessCode);
  }

  return headers;
}
