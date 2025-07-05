export const OWNER = "Hk-Gosuto";
export const REPO = "ChatGPT-Next-Web-LangChain";
export const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
export const PLUGINS_REPO_URL = `https://github.com/${OWNER}/JChat-Awesome-Plugins`;
export const ISSUE_URL = `https://github.com/${OWNER}/${REPO}/issues`;

export const RELEASE_URL = `${REPO_URL}/releases`;

export const RUNTIME_CONFIG_DOM = "danger-runtime-config";

export const STABILITY_BASE_URL = "https://api.stability.ai";

export const OPENAI_BASE_URL = "https://api.openai.com";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export const CACHE_URL_PREFIX = "/api/cache";
export const UPLOAD_URL = `${CACHE_URL_PREFIX}/upload`;

export enum Path {
  Home = "/",
  Chat = "/chat",
  Settings = "/settings",
  NewChat = "/new-chat",
  Auth = "/auth",
  Artifacts = "/artifacts",
}

export enum ApiPath {
  Cors = "",
  OpenAI = "/api/openai",
  Anthropic = "/api/anthropic",
  Stability = "/api/stability",
  Artifacts = "/api/artifacts",
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

export enum ServiceProvider {
  OpenAI = "OpenAI",
  Anthropic = "Anthropic",
  Stability = "Stability",
}

export enum ModelProvider {
  Stability = "Stability",
  GPT = "GPT",
  Claude = "Claude",
}

export const Stability = {
  GeneratePath: "v2beta/stable-image/generate",
  ExampleEndpoint: "https://api.stability.ai",
};

export const Anthropic = {
  ChatPath: "v1/messages",
  ChatPath1: "v1/complete",
  ExampleEndpoint: "https://api.anthropic.com",
  Vision: "2023-06-01",
};

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
  "gpt-4-turbo": "2023-12",
  "gpt-4-turbo-2024-04-09": "2023-12",
  "gpt-4-turbo-preview": "2023-12",
  "gpt-4o": "2023-10",
  "gpt-4o-2024-05-13": "2023-10",
  "gpt-4o-2024-08-06": "2023-10",
  "gpt-4o-2024-11-20": "2023-10",
  "chatgpt-4o-latest": "2023-10",
  "gpt-4o-mini": "2023-10",
  "gpt-4o-mini-2024-07-18": "2023-10",
  "gpt-4-vision-preview": "2023-04",
  "o1-mini-2024-09-12": "2023-10",
  "o1-mini": "2023-10",
  "o1-preview-2024-09-12": "2023-10",
  "o1-preview": "2023-10",
  "o1-2024-12-17": "2023-10",
  o1: "2023-10",
  "o1-pro": "2023-10",
  "o3-mini-2025-01-31": "2023-10",
  "o3-mini": "2023-10",
  "gpt-4.1": "2024-6",
  "gpt-4.1-mini": "2024-6",
  "gpt-4.1-nano": "2024-6",
};

export const VISION_MODEL_REGEXES = [
  /vision/,
  /gpt-4o/,
  /gpt-4o-mini/,
  /gpt-4\.1/,
  /gpt-4\.1-mini/,
  /gpt-4\.1-nano/,
  /gpt-4\.5-preview/,
  /gpt-4\.5-preview-2025-02-27/,
  /claude-3/,
  /gpt-4-turbo(?!.*preview)/, // Matches "gpt-4-turbo" but not "gpt-4-turbo-preview"
  /^dall-e-3$/, // Matches exactly "dall-e-3"
  /^gpt-image-1$/,
  /o1/,
  /o3/,
  /o4-mini/,
];

export const EXCLUDE_VISION_MODEL_REGEXES = [/claude-3-5-haiku-20241022/];

const openaiModels = [
  // As of July 2024, gpt-4o-mini should be used in place of gpt-3.5-turbo,
  // as it is cheaper, more capable, multimodal, and just as fast. gpt-3.5-turbo is still available for use in the API.
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-1106",
  "gpt-3.5-turbo-0125",
  "gpt-4",
  "gpt-4-0613",
  "gpt-4-32k",
  "gpt-4-32k-0613",
  "gpt-4-turbo",
  "gpt-4-turbo-preview",
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "chatgpt-4o-latest",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4-vision-preview",
  "gpt-4-turbo-2024-04-09",
  "gpt-4-1106-preview",
  "gpt-4.5-preview",
  "gpt-4.5-preview-2025-02-27",
  "dall-e-3",
  "o1",
  "o1-mini",
  "o1-preview",
  "o1-pro",
  "o3-mini",
  "o3",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-image-1",
  "o4-mini",
];

const anthropicModels = [
  "claude-2.0",
  "claude-2.1",
  "claude-3-sonnet-20240229",
  "claude-3-opus-20240229",
  "claude-3-opus-latest",
  "claude-3-haiku-20240307",
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest",
];

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
  ...anthropicModels.map((name) => ({
    name,
    available: true,
    sorted: seq++,
    provider: {
      id: "anthropic",
      providerName: "Anthropic",
      providerType: "anthropic",
      sorted: 2,
    },
  })),
] as const;

export const CHAT_PAGE_SIZE = 15;
export const MAX_RENDER_MSG_COUNT = 45;

// some famous webdav endpoints
export const internalAllowedWebDavEndpoints = [
  "https://dav.jianguoyun.com/dav/",
  "https://dav.dropdav.com/",
  "https://dav.box.com/dav",
  "https://nanao.teracloud.jp/dav/",
  "https://bora.teracloud.jp/dav/",
  "https://webdav.4shared.com/",
  "https://dav.idrivesync.com",
  "https://webdav.yandex.com",
  "https://app.koofr.net/dav/Koofr",
];

export const DEFAULT_GA_ID = "G-89WN60ZK2E";
