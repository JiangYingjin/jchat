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

export enum StoreKey {
  Chat = "chats",
  Access = "access",
  Config = "config",
  Sync = "sync",
}

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;
export const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;
export const NARROW_SIDEBAR_WIDTH = 80;

export const STORAGE_KEY = "jchat";

export const REQUEST_TIMEOUT_MS = 60000;
export const REQUEST_TIMEOUT_MS_FOR_THINKING = REQUEST_TIMEOUT_MS * 5;
export const REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION = REQUEST_TIMEOUT_MS * 5;

export const EXPORT_MESSAGE_CLASS_NAME = "export-markdown";

export const OpenaiPath = {
  ChatPath: "v1/chat/completions",
  ImagePath: "v1/images/generations",
  ListModelPath: "v1/models",
};

export const DEFAULT_MODELS = ["google/gemini-2.5-flash"] as const;

export const CHAT_PAGE_SIZE = 15;
export const MAX_RENDER_MSG_COUNT = 45;
