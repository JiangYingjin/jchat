import { useEffect, useState } from "react";
import { showToast } from "./components/ui-lib";
import Locale, { getLang } from "./locales";
import { MultimodalContent, RequestMessage } from "./client/api";
import {
  DEFAULT_MODELS,
  EXCLUDE_VISION_MODEL_REGEXES,
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
  VISION_MODEL_REGEXES,
} from "./constant";
import { ServiceProvider } from "./constant";
// import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { fetch as tauriStreamFetch } from "./utils/stream";
import {
  WEB_SEARCH_ANSWER_EN_PROMPT,
  WEB_SEARCH_ANSWER_ZH_PROMPT,
} from "./prompt";
import { useAccessStore } from "./store";

export function trimTopic(topic: string) {
  // Fix an issue where double quotes still show in the Indonesian language
  // This will remove the specified punctuation from the end of the string
  // and also trim quotes from both the start and end if they exist.
  return (
    topic
      // fix for gemini
      .replace(/^["""*]+|["""*]+$/g, "")
      .replace(/[，。！？""""、,.!?*]*$/, "")
  );
}

export async function copyToClipboard(text: string) {
  try {
    if (window.__TAURI__) {
      window.__TAURI__.writeText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }

    showToast(Locale.Copy.Success);
  } catch (error) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      showToast(Locale.Copy.Success);
    } catch (error) {
      showToast(Locale.Copy.Failed);
    }
    document.body.removeChild(textArea);
  }
}

export async function downloadAs(text: string, filename: string) {
  if (window.__TAURI__) {
    const result = await window.__TAURI__.dialog.save({
      defaultPath: `${filename}`,
      filters: [
        {
          name: `${filename.split(".").pop()} files`,
          extensions: [`${filename.split(".").pop()}`],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (result !== null) {
      try {
        await window.__TAURI__.fs.writeTextFile(result, text);
        showToast(Locale.Download.Success);
      } catch (error) {
        showToast(Locale.Download.Failed);
      }
    } else {
      showToast(Locale.Download.Failed);
    }
  } else {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(text),
    );
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
  }
}

export function readFromFile() {
  return new Promise<string>((res, rej) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json";

    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      const fileReader = new FileReader();
      fileReader.onload = (e: any) => {
        res(e.target.result);
      };
      fileReader.onerror = (e) => rej(e);
      fileReader.readAsText(file);
    };

    fileInput.click();
  });
}

export function isIOS() {
  const userAgent = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return size;
}

export const MOBILE_MAX_WIDTH = 600;
export function useMobileScreen() {
  const { width } = useWindowSize();

  return width <= MOBILE_MAX_WIDTH;
}

export function isFirefox() {
  return (
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)
  );
}

function getDomContentWidth(dom: HTMLElement) {
  const style = window.getComputedStyle(dom);
  const paddingWidth =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = dom.clientWidth - paddingWidth;
  return width;
}

function getOrCreateMeasureDom(id: string, init?: (dom: HTMLElement) => void) {
  let dom = document.getElementById(id);

  if (!dom) {
    dom = document.createElement("span");
    dom.style.position = "absolute";
    dom.style.wordBreak = "break-word";
    dom.style.fontSize = "14px";
    dom.style.transform = "translateY(-200vh)";
    dom.style.pointerEvents = "none";
    dom.style.opacity = "0";
    dom.id = id;
    document.body.appendChild(dom);
    init?.(dom);
  }

  return dom!;
}

export function autoGrowTextArea(dom: HTMLTextAreaElement) {
  const measureDom = getOrCreateMeasureDom("__measure");
  const singleLineDom = getOrCreateMeasureDom("__single_measure", (dom) => {
    dom.innerText = "TEXT_FOR_MEASURE";
  });

  const width = getDomContentWidth(dom);
  measureDom.style.width = width + "px";
  measureDom.innerText = dom.value !== "" ? dom.value : "1";
  measureDom.style.fontSize = dom.style.fontSize;
  measureDom.style.fontFamily = dom.style.fontFamily;
  const endWithEmptyLine = dom.value.endsWith("\n");
  const height = parseFloat(window.getComputedStyle(measureDom).height);
  const singleLineHeight = parseFloat(
    window.getComputedStyle(singleLineDom).height,
  );

  const rows =
    Math.round(height / singleLineHeight) + (endWithEmptyLine ? 1 : 0);

  return rows;
}

export function getCSSVar(varName: string) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

/**
 * Detects Macintosh
 */
export function isMacOS(): boolean {
  if (typeof window !== "undefined") {
    let userAgent = window.navigator.userAgent.toLocaleLowerCase();
    const macintosh = /iphone|ipad|ipod|macintosh/.test(userAgent);
    return !!macintosh;
  }
  return false;
}

export function getWebReferenceMessageTextContent(message: RequestMessage) {
  let prompt = getMessageTextContent(message);
  if (
    message.webSearchReferences &&
    message.webSearchReferences.results.length > 0
  ) {
    const searchResults = message.webSearchReferences.results
      .map((result, index) => {
        return `[webpage ${index + 1} begin]
[webpage title]${result.title}
[webpage url]${result.url}
[webpage content begin]
${result.content}
[webpage content end]
[webpage ${index + 1} end]
`;
      })
      .join("\n");
    const isZh = getLang() == "cn";
    const promptTemplate = isZh
      ? WEB_SEARCH_ANSWER_ZH_PROMPT
      : WEB_SEARCH_ANSWER_EN_PROMPT;
    prompt = promptTemplate
      .replace("{cur_date}", new Date().toLocaleString())
      .replace("{search_results}", searchResults)
      .replace("{question}", prompt);
  }
  return prompt;
}

export function getMessageTextContent(message: RequestMessage) {
  return getTextContent(message.content);
}

export function getMessageTextReasoningContent(message: RequestMessage) {
  return getTextContent(message.reasoningContent ?? "");
}

export function getTextContent(content: string | MultimodalContent[]) {
  if (typeof content === "string") {
    return content;
  }
  let combinedText = "";
  for (const c of content) {
    if (c.type === "text") {
      combinedText += (c.text ?? "") + " ";
    }
  }
  return combinedText.trim();
}

export function getMessageTextContentWithoutThinking(message: RequestMessage) {
  let content = "";

  if (typeof message.content === "string") {
    content = message.content;
  } else {
    for (const c of message.content) {
      if (c.type === "text") {
        content = c.text ?? "";
        break;
      }
    }
  }

  // Filter out thinking lines (starting with "> ")
  return content
    .split("\n")
    .filter((line) => !line.startsWith("> ") && line.trim() !== "")
    .join("\n")
    .trim();
}

export function getMessageImages(message: RequestMessage): string[] {
  if (typeof message.content === "string") {
    return [];
  }
  const urls: string[] = [];
  for (const c of message.content) {
    if (c.type === "image_url") {
      urls.push(c.image_url?.url ?? "");
    }
  }
  return urls;
}

export function isVisionModel(model: string) {
  return true;
  const visionModels = useAccessStore.getState().visionModels;
  const envVisionModels = visionModels?.split(",").map((m) => m.trim());
  if (envVisionModels?.includes(model)) {
    return true;
  }
  return (
    !EXCLUDE_VISION_MODEL_REGEXES.some((regex) => regex.test(model)) &&
    VISION_MODEL_REGEXES.some((regex) => regex.test(model))
  );
}

export function getTimeoutMSByModel(model: string) {
  model = model.toLowerCase();
  if (model.startsWith("gemini-2.0-flash-exp")) {
    return REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION;
  }
  if (
    model.startsWith("dall-e") ||
    model.startsWith("dalle") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.includes("deepseek-r") ||
    model.includes("-thinking")
  )
    return REQUEST_TIMEOUT_MS_FOR_THINKING;
  return REQUEST_TIMEOUT_MS;
}

export function showPlugins(provider: ServiceProvider, model: string) {
  if (
    provider == ServiceProvider.OpenAI ||
    provider == ServiceProvider.Azure ||
    provider == ServiceProvider.Moonshot ||
    provider == ServiceProvider.ChatGLM
  ) {
    return true;
  }
  if (provider == ServiceProvider.Anthropic && !model.includes("claude-2")) {
    return true;
  }
  if (provider == ServiceProvider.Google && !model.includes("vision")) {
    return true;
  }
  return false;
}

export function isSupportRAGModel(modelName: string) {
  const specialModels = [
    "gpt-4-turbo",
    "gpt-4-turbo-2024-04-09",
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-4.5-preview",
    "gpt-4.5-preview-2025-02-27",
  ];
  if (specialModels.some((keyword) => modelName === keyword)) return true;
  if (isVisionModel(modelName)) return false;
  return DEFAULT_MODELS.filter((model) => model.provider.id === "openai").some(
    (model) => model.name === modelName,
  );
}

export function isFunctionCallModel(modelName: string) {
  return false;
  const functionCallModels = ["gemini", "claude", "gpt", "deepseek", "hunyuan"];
  return functionCallModels.some((keyword) => modelName.includes(keyword));
}

export function isClaudeThinkingModel(modelName: string) {
  const specialModels = [
    "claude-3-7-sonnet-20250219",
    "claude-3-7-sonnet-latest",
  ];
  return specialModels.some((keyword) => modelName === keyword);
}

export function isImageGenerationModel(modelName: string) {
  const specialModels = ["gemini-2.0-flash-exp"];
  return specialModels.some((keyword) => modelName === keyword);
}

export function fetch(
  url: string,
  options?: Record<string, unknown>,
): Promise<any> {
  if (window.__TAURI__) {
    return tauriStreamFetch(url, options);
  }
  return window.fetch(url, options);
}

export function adapter(config: Record<string, unknown>) {
  const { baseURL, url, params, data: body, ...rest } = config;
  const path = baseURL ? `${baseURL}${url}` : url;
  const fetchUrl = params
    ? `${path}?${new URLSearchParams(params as any).toString()}`
    : path;
  return fetch(fetchUrl as string, { ...rest, body }).then((res) => {
    const { status, headers, statusText } = res;
    return res
      .text()
      .then((data: string) => ({ status, statusText, headers, data }));
  });
}

export function safeLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} {
  let storage: Storage | null;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storage = window.localStorage;
    } else {
      storage = null;
    }
  } catch (e) {
    console.error("localStorage is not available:", e);
    storage = null;
  }

  return {
    getItem(key: string): string | null {
      if (storage) {
        return storage.getItem(key);
      } else {
        console.warn(
          `Attempted to get item "${key}" from localStorage, but localStorage is not available.`,
        );
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (storage) {
        storage.setItem(key, value);
      } else {
        console.warn(
          `Attempted to set item "${key}" in localStorage, but localStorage is not available.`,
        );
      }
    },
    removeItem(key: string): void {
      if (storage) {
        storage.removeItem(key);
      } else {
        console.warn(
          `Attempted to remove item "${key}" from localStorage, but localStorage is not available.`,
        );
      }
    },
    clear(): void {
      if (storage) {
        storage.clear();
      } else {
        console.warn(
          "Attempted to clear localStorage, but localStorage is not available.",
        );
      }
    },
  };
}

export function getOperationId(operation: {
  operationId?: string;
  method: string;
  path: string;
}) {
  // pattern '^[a-zA-Z0-9_-]+$'
  return (
    operation?.operationId ||
    `${operation.method.toUpperCase()}${operation.path.replaceAll("/", "_")}`
  );
}

/**
 * 检查 localStorage 使用情况，并可选地删除大小小于或等于指定字节阈值的项。
 *
 * @param {number | null} [evictThreshold=null] - 如果提供，任何大小（字节）小于或等于此值的项都将被删除。
 *                                               如果为 null，则只报告不删除。
 * @returns {{totalSize: number, items: object, evictedCount: number}} 包含总大小、当前项大小和被删除项数量的对象。
 */
export function checkAndEvictLocalStorage(
  evictThreshold: number | null = null,
) {
  let totalSize = 0;
  const currentItems: Record<string, number> = {}; // 存储当前 localStorage 中的项
  const keysToEvict: string[] = []; // 存储待删除的键
  let evictedCount = 0; // 统计删除的数量

  // 1. 遍历并收集信息，同时标记要删除的键
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue; // 修正key为null时报错
    const value = localStorage.getItem(key);
    const size = value ? value.length : 0; // 字符串长度近似字节大小

    totalSize += size;
    currentItems[key] = size;

    if (evictThreshold !== null && size <= evictThreshold) {
      keysToEvict.push(key);
    }
  }

  // 2. 执行删除操作
  for (const key of keysToEvict) {
    localStorage.removeItem(key);
    evictedCount++;
    // 从总大小和当前项列表中移除被删除的项（可选，但让报告更精确）
    totalSize -= currentItems[key];
    delete currentItems[key];
  }

  // 3. 打印报告
  console.log("--- localStorage Usage Report ---");
  console.log("Total Size:", (totalSize / 1024 / 1024).toFixed(2), "MB");
  console.log("Current Item Sizes:", currentItems);

  if (evictThreshold !== null) {
    if (evictedCount > 0) {
      console.log(
        `Evicted ${evictedCount} item(s) with size <= ${evictThreshold} bytes.`,
      );
    } else {
      console.log(`No items evicted (threshold: ${evictThreshold} bytes).`);
    }
  }

  return { totalSize, items: currentItems, evictedCount };
}
