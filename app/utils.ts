import { useEffect, useState } from "react";
import { showToast } from "./components/ui-lib";
import Locale from "./locales";
import { MultimodalContent, RequestMessage } from "./client/api";
import {
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION,
} from "./constant";

export const isClient = typeof window !== "undefined";

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
    await navigator.clipboard.writeText(text);
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

// 更高效的下载：使用 Blob + Object URL，避免对大文本进行 encodeURIComponent
export async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // 延迟释放，兼容部分浏览器的下载完成时机
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

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

function getDomContentWidth(dom: HTMLElement) {
  const style =
    typeof window !== "undefined" ? window.getComputedStyle(dom) : null;
  if (!style) return 0;
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
  const height =
    typeof window !== "undefined"
      ? parseFloat(window.getComputedStyle(measureDom).height)
      : 0;
  const singleLineHeight =
    typeof window !== "undefined"
      ? parseFloat(window.getComputedStyle(singleLineDom).height)
      : 0;

  const rows =
    Math.round(height / singleLineHeight) + (endWithEmptyLine ? 1 : 0);

  return rows;
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

export function getTimeoutMSByModel(model: string) {
  model = model.toLowerCase();
  if (model.startsWith("gemini-2.0-flash-exp")) {
    return REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION;
  }
  return REQUEST_TIMEOUT_MS;
}

// 在 Web Worker 中执行 JSON.stringify，避免阻塞主线程。
// 如果 Worker 不可用或失败，自动回退至主线程执行。
export async function jsonStringifyOffMainThread(
  data: unknown,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return JSON.stringify(data);
  }

  const workerCode = `self.onmessage = function(e){
  try {
    const json = JSON.stringify(e.data);
    self.postMessage({ ok: true, json });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};`;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (!settled) {
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        cleanup();
        // 超时回退到主线程
        try {
          resolve(JSON.stringify(data));
        } catch (e) {
          reject(e);
        }
      }
    }, timeoutMs);

    worker.onmessage = (ev: MessageEvent) => {
      if (settled) return;
      clearTimeout(timer);
      const { ok, json, error } = ev.data || {};
      if (ok) {
        cleanup();
        resolve(json as string);
      } else {
        cleanup();
        // Worker 出错，回退到主线程
        try {
          resolve(JSON.stringify(data));
        } catch (e) {
          reject(error || e);
        }
      }
    };

    worker.onerror = () => {
      if (settled) return;
      clearTimeout(timer);
      cleanup();
      // Worker 不可用，回退到主线程
      try {
        resolve(JSON.stringify(data));
      } catch (e) {
        reject(e);
      }
    };

    worker.postMessage(data);
  });
}
