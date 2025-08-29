export const STORAGE_KEY = "jchat";
export const CACHE_URL_PREFIX = "/api/cache";
export const UPLOAD_URL = `${CACHE_URL_PREFIX}/upload`;

export enum Path {
  Home = "/",
  Chat = "/chat",
  Settings = "/settings",
  Auth = "/auth",
}

export enum ApiPath {
  OpenAI = "/api/openai",
}

export const OpenaiPath = {
  ChatPath: "v1/chat/completions",
  ImagePath: "v1/images/generations",
};

export enum SlotID {
  AppBody = "app-body",
}

export enum StoreKey {
  Chat = "chats",
  ExportFormat = "export-format",
}

export const DEFAULT_SIDEBAR_WIDTH = 180;

export const REQUEST_TIMEOUT_MS = 60000;
export const REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION = REQUEST_TIMEOUT_MS * 5;

export const EXPORT_MESSAGE_CLASS_NAME = "export-markdown";

export const FALLBACK_BASE_URL = "oneapi.jyj.cx";
export const FALLBACK_MODEL = "jyj.cx/flash";
export const PRO_MODEL = "jyj.cx/pro";
export const GROUP_SESSION_PREFERRED_MODEL = "jyj.cx/think";

export const CHAT_PAGE_SIZE = 15;
export const MAX_RENDER_MSG_COUNT = 45;

export const DEFAULT_FONT_SIZE = 14.5;
export const DEFAULT_FONT_FAMILY = "";
export enum Theme {
  Auto = "auto",
  Light = "light",
  Dark = "dark",
}
export const DEFAULT_THEME = Theme.Auto;
