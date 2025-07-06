export const OWNER = "Hk-Gosuto";
export const REPO = "ChatGPT-Next-Web-LangChain";
export const REPO_URL = `https://github.com/${OWNER}/${REPO}`;

export const ISSUE_URL = `https://github.com/${OWNER}/${REPO}/issues`;

export const RELEASE_URL = `${REPO_URL}/releases`;

export const RUNTIME_CONFIG_DOM = "danger-runtime-config";

export const OPENAI_BASE_URL = "https://api.openai.com";

export const CACHE_URL_PREFIX = "/api/cache";
export const UPLOAD_URL = `${CACHE_URL_PREFIX}/upload`;

export enum Path {
  Home = "/",
  Chat = "/chat",
  Settings = "/settings",
  Auth = "/auth",
}

export enum ApiPath {
  Cors = "",
  OpenAI = "/api/openai",
}

export enum SlotID {
  AppBody = "app-body",
  CustomModel = "custom-model",
}

export enum FileName {
  Prompts = "prompts.json",
}

export enum StoreKey {
  Chat = "chat-next-web-store",
  Access = "access-control",
  Config = "app-config",
  Sync = "sync",
}

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;
export const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;
export const NARROW_SIDEBAR_WIDTH = 80;

export const ACCESS_CODE_PREFIX = "nk-";

export const CHAT_INPUT_TEXT = (id: string) => "chat-input-text-" + id;
export const CHAT_INPUT_IMAGES = (id: string) => "chat-input-images-" + id;
export const CHAT_INPUT_SCROLL_TOP = (id: string) =>
  "chat-input-scroll-top-" + id;

export const STORAGE_KEY = "chatgpt-next-web";

export const REQUEST_TIMEOUT_MS = 60000;
export const REQUEST_TIMEOUT_MS_FOR_THINKING = REQUEST_TIMEOUT_MS * 5;
export const REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION = REQUEST_TIMEOUT_MS * 5;

export const EXPORT_MESSAGE_CLASS_NAME = "export-markdown";

export enum ModelProvider {
  GPT = "GPT",
}

export const OpenaiPath = {
  ChatPath: "v1/chat/completions",
  ImagePath: "v1/images/generations",
  TranscriptionPath: "v1/audio/transcriptions",
  UsagePath: "dashboard/billing/usage",
  SubsPath: "dashboard/billing/subscription",
  ListModelPath: "v1/models",
};

export const DEFAULT_INPUT_TEMPLATE = `{{input}}`; // input / time / model / lang

export const SUMMARIZE_MODEL = "gpt-4o-mini";

export const KnowledgeCutOffDate: Record<string, string> = {
  default: "2021-09",
  "gpt-4.1-mini": "2024-6",
};

const openaiModels = ["gpt-4.1-mini"];

let seq = 1000; // 内置的模型序号生成器从1000开始
export const DEFAULT_MODELS = [
  ...openaiModels.map((name) => ({
    name,
    available: true,
    sorted: seq++, // Global sequence sort(index)
    provider: {
      id: "openai",
      providerName: "OpenAI",
      providerType: "openai",
      sorted: 1, // 这里是固定的，确保顺序与之前内置的版本一致
    },
  })),
] as const;

export const CHAT_PAGE_SIZE = 15;
export const MAX_RENDER_MSG_COUNT = 45;
