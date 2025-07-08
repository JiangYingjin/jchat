import { ModelType, useAccessStore, useChatStore } from "../store";
import { ChatGPTApi } from "./platforms/openai";
import { FileApi } from "./platforms/utils";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export type ChatModel = ModelType;

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

export interface LLMConfig {
  model: string;
  stream?: boolean;
}

export interface ChatOptions {
  messages: RequestMessage[];
  config: LLMConfig;

  onToolUpdate?: (toolName: string, toolInput: string) => void;
  onUpdate?: (message: string | MultimodalContent[], chunk: string) => void;
  onReasoningUpdate?: (message: string, chunk: string) => void;
  onFinish: (
    message: string | MultimodalContent[],
    responseRes: Response,
    usage?: {
      completion_tokens?: number;
      prompt_tokens?: number;
      total_tokens?: number;
    },
  ) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
}

export interface LLMModel {
  name: string;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;

  abstract models(): Promise<LLMModel[]>;
}

export abstract class ToolApi {
  abstract call(input: string): Promise<string>;
  abstract name: string;
  abstract description: string;
}

export class ClientApi {
  public llm: LLMApi;
  public file: FileApi;

  constructor() {
    this.llm = new ChatGPTApi();
    this.file = new FileApi();
  }
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

export function getHeaders(ignoreHeaders: boolean = false) {
  const accessStore = useAccessStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  if (validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(accessStore.accessCode);
  }

  return headers;
}

export function getClientApi(): ClientApi {
  return new ClientApi();
}
