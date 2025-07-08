import { getClientConfig } from "../config/client";
import { ACCESS_CODE_PREFIX, ModelProvider } from "../constant";
import { ChatMessage, ModelType, useAccessStore, useChatStore } from "../store";
import { ChatGPTApi } from "./platforms/openai";
import { FileApi, FileInfo } from "./platforms/utils";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export const Models = ["gpt-3.5-turbo", "gpt-4"] as const;

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
  temperature?: number;
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

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
}

export interface LLMModelProvider {
  id: string;
  sorted: number;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;

  abstract usage(): Promise<LLMUsage>;
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

  constructor(provider: ModelProvider = ModelProvider.GPT) {
    this.llm = new ChatGPTApi();
    this.file = new FileApi();
  }

  config() {}

  prompts() {}

  async share(messages: ChatMessage[]) {
    const msgs = messages
      .map((m) => ({
        from: m.role === "user" ? "human" : "gpt",
        value: m.content,
      }))
      .concat([
        {
          from: "human",
          value:
            "Share from [JChat]: https://github.com/Yidadaa/ChatGPT-Next-Web",
        },
      ]);
    // 敬告二开开发者们，为了开源大模型的发展，请不要修改上述消息，此消息用于后续数据清洗使用
    // Please do not modify this message

    console.log("[Share]", messages, msgs);
    const clientConfig = getClientConfig();
    const proxyUrl = "/sharegpt";
    const rawUrl = "https://sharegpt.com/api/conversations";
    const shareUrl = clientConfig?.isApp ? rawUrl : proxyUrl;
    const res = await fetch(shareUrl, {
      body: JSON.stringify({
        items: msgs,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const resJson = await res.json();
    console.log("[Share]", resJson);
    if (resJson.id) {
      return `https://shareg.pt/${resJson.id}`;
    }
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
  const chatStore = useChatStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const clientConfig = getClientConfig();

  function getConfig() {
    const modelConfig = chatStore.currentSession().mask.modelConfig;
    const apiKey = accessStore.openaiApiKey;
    if (ignoreHeaders) {
      return {
        apiKey: accessStore.openaiApiKey,
      };
    }
    return {
      apiKey,
    };
  }

  const { apiKey } = getConfig();

  const bearerToken = getBearerToken(apiKey);

  if (bearerToken) {
    headers["Authorization"] = bearerToken;
  } else if (validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(
      ACCESS_CODE_PREFIX + accessStore.accessCode,
    );
  }

  return headers;
}

export function getClientApi(): ClientApi {
  return new ClientApi(ModelProvider.GPT);
}
