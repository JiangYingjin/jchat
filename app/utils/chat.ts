import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import {
  ImageContent,
  MultimodalContent,
  RequestMessage,
  MessageContentItem,
} from "@/app/client/api";
import Locale from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { getMessageTextContent } from "../utils";

declare global {
  interface Window {
    _SW_ENABLED: boolean;
  }
}

export function compressImage(file: Blob, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent: any) => {
      const image = new Image();
      image.onload = () => {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = image.width;
        let height = image.height;
        let quality = 0.9;
        let dataUrl;

        do {
          canvas.width = width;
          canvas.height = height;
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(image, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);

          if (dataUrl.length < maxSize) break;

          if (quality > 0.5) {
            // Prioritize quality reduction
            quality -= 0.1;
          } else {
            // Then reduce the size
            width *= 0.9;
            height *= 0.9;
          }
        } while (dataUrl.length > maxSize);

        resolve(dataUrl);
      };
      image.onerror = reject;
      image.src = readerEvent.target.result;
    };
    reader.onerror = reject;

    if (file.type.includes("heic")) {
      try {
        const heic2any = require("heic2any");
        heic2any({ blob: file, toType: "image/jpeg" })
          .then((blob: Blob) => {
            reader.readAsDataURL(blob);
          })
          .catch((e: any) => {
            reject(e);
          });
      } catch (e) {
        reject(e);
      }
    }

    reader.readAsDataURL(file);
  });
}

export async function preProcessImageContent(
  content: RequestMessage["content"],
) {
  if (typeof content === "string") {
    return content;
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await cacheImageToBase64Image(part?.image_url?.url);
        result.push({ type: part.type, image_url: { url } });
      } catch (error) {
        console.error("Error processing image URL:", error);
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

const imageCaches: Record<string, string> = {};
export function cacheImageToBase64Image(imageUrl: string) {
  if (imageUrl.includes(CACHE_URL_PREFIX)) {
    if (!imageCaches[imageUrl]) {
      console.log("[Cache] Fetching image for caching:", imageUrl);
      const reader = new FileReader();
      return fetch(imageUrl, {
        method: "GET",
        mode: "cors",
        credentials: "include",
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch image: ${res.status}`);
          }
          return res.blob();
        })
        .then(async (blob) => {
          console.log("[Cache] Compressing image, size:", blob.size);
          const compressed = await compressImage(blob, 256 * 1024);
          imageCaches[imageUrl] = compressed;
          return compressed;
        })
        .catch((error) => {
          console.error("[Cache] Error caching image:", error);
          // 返回原始 URL 作为备用
          return imageUrl;
        });
    }
    return Promise.resolve(imageCaches[imageUrl]);
  }
  return Promise.resolve(imageUrl);
}

export function base64Image2Blob(base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

export function uploadImage(file: Blob): Promise<string> {
  if (!window._SW_ENABLED) {
    // if serviceWorker register error, using compressImage
    return compressImage(file, 256 * 1024);
  }

  const body = new FormData();
  body.append("file", file);

  return fetch(UPLOAD_URL, {
    method: "post",
    body,
    mode: "cors",
    credentials: "include",
  })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.json();
    })
    .then((res) => {
      if (res?.code === 0 && res?.data) {
        return res.data;
      }
      throw new Error(`upload Error: ${res?.msg || "Unknown error"}`);
    })
    .catch((error) => {
      console.error("[Upload] failed, falling back to compressImage:", error);
      // 如果 ServiceWorker 上传失败，回退到压缩图片
      return compressImage(file, 256 * 1024);
    });
}

export function removeImage(imageUrl: string) {
  console.log("[Remove] Removing image:", imageUrl);
  return fetch(imageUrl, {
    method: "DELETE",
    mode: "cors",
    credentials: "include",
  })
    .then((res) => {
      console.log("[Remove] Response status:", res.status);
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to remove image: ${res.status}`);
      }
      return res;
    })
    .catch((error) => {
      console.error("[Remove] Error removing image:", error);
      throw error;
    });
}

export async function stream(
  chatPath: string,
  requestPayload: any,
  headers: any,
  controller: AbortController,
  parseSSE: (text: string) => string | ImageContent | undefined,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let contentQueue: MessageContentItem[] = [];
  let multimodalTextContent: MultimodalContent = { type: "text", text: "" };
  let multimodalContent: MultimodalContent[] = [multimodalTextContent];
  let imageContext: ImageContent | null = null;

  // animate response to make it looks smooth
  async function animateResponseText() {
    if (contentQueue.length > 0) {
      const chunk = contentQueue.shift();
      if (chunk?.type === "text") {
        remainText += chunk.content;
      } else if (chunk?.type === "image") {
        imageContext = chunk.content as ImageContent;
      }
    }
    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      // responseText += fetchText;
      multimodalTextContent.text += fetchText;
      remainText = remainText.slice(fetchCount);
    }
    if (imageContext) {
      multimodalContent.push({
        type: "image_url",
        image_url: {
          url: await uploadImage(
            base64Image2Blob(imageContext.data, imageContext.mimeType),
          ),
        },
      });
      imageContext = null;
      let newMultimodalTextContent: MultimodalContent = {
        type: "text",
        text: "",
      };
      multimodalTextContent = newMultimodalTextContent;
      multimodalContent.push(newMultimodalTextContent);
    }
    options.onUpdate?.(multimodalContent, "");

    if ((finished || controller.signal.aborted) && contentQueue.length === 0) {
      multimodalTextContent.text += remainText;
      options.onUpdate?.(multimodalContent, "");
      // console.log("[Response Animation] finished");
      if (
        responseText?.length === 0 &&
        multimodalContent.at(0)?.text?.length == 0 &&
        multimodalContent.length == 1
      ) {
        options.onError?.(new Error("empty response from server"));
      }
      options.onFinish(multimodalContent);
      return;
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  await animateResponseText();

  const finish = () => {
    if (!finished) {
      console.debug("[ChatAPI] end");
      finished = true;
      options.onFinish(multimodalContent);
    }
  };

  controller.signal.onabort = finish;

  function chatApi(chatPath: string, headers: any, requestPayload: any) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        // console.log("[Request] response content type: ", contentType);

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            // 处理未授权响应：清空 accessCode 并跳转到 auth 页面
            if (
              typeof window !== "undefined" &&
              (window as any).__handleUnauthorized
            ) {
              (window as any).__handleUnauthorized();
            }
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        try {
          const chunk = parseSSE(msg.data);
          console.log("chunk", chunk);
          if (chunk && typeof chunk === "string") {
            contentQueue.push({
              type: "text",
              content: chunk,
            });
          } else if (chunk) {
            contentQueue.push({
              type: "image",
              content: chunk,
            });
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload); // call fetchEventSource
}

export function streamWithThink(
  chatPath: string,
  requestPayload: any,
  headers: any,
  controller: AbortController,
  parseSSE: (text: string) => {
    isThinking: boolean;
    content: string | undefined;
  },
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let reasoningResponseText = "";
  let reasoningRemainText = "";
  let finished = false;
  let responseRes: Response;
  let isInThinkingMode = false;
  let lastIsThinking = false;
  let thinkingModeEnded = false;
  let usageInfo:
    | {
        completion_tokens?: number;
        prompt_tokens?: number;
        total_tokens?: number;
      }
    | undefined;

  // animate response to make it looks smooth
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      // console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        options.onError?.(new Error("empty response from server"));
      }
      return;
    }

    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    if (thinkingModeEnded && reasoningRemainText.length > 0) {
      reasoningResponseText += reasoningRemainText;
      reasoningResponseText = reasoningResponseText.replace(/^\s*\n/gm, "");
      const remainingReasoning = reasoningRemainText;
      reasoningRemainText = "";
      options.onReasoningUpdate?.(reasoningResponseText, remainingReasoning);
      thinkingModeEnded = false;
    } else if (reasoningRemainText.length > 0) {
      const fetchCount = Math.max(
        1,
        Math.round(reasoningRemainText.length / 60),
      );
      const fetchText = reasoningRemainText.slice(0, fetchCount);
      reasoningResponseText += fetchText;
      reasoningResponseText = reasoningResponseText.replace(/^\s*\n/gm, "");
      reasoningRemainText = reasoningRemainText.slice(fetchCount);
      options.onReasoningUpdate?.(reasoningResponseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  animateResponseText();

  const finish = () => {
    if (!finished) {
      console.debug("[ChatAPI] end");
      finished = true;
      options.onFinish(responseText + remainText, responseRes, usageInfo);
    }
  };

  controller.signal.onabort = finish;

  function chatApi(chatPath: string, headers: any, requestPayload: any) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: (input, init) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          REQUEST_TIMEOUT_MS,
        );
        return fetch(input, {
          ...(init || {}),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      },
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        // console.log("[Request] response content type: ", contentType);
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            // 处理未授权响应：清空 accessCode 并跳转到 auth 页面
            if (
              typeof window !== "undefined" &&
              (window as any).__handleUnauthorized
            ) {
              (window as any).__handleUnauthorized();
            }
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          // 先检查是否有 usage 信息
          try {
            const json = JSON.parse(text);
            if (json.usage) {
              usageInfo = json.usage;
              console.log("[Usage Info]", usageInfo);
            }
          } catch (usageParseError) {
            // 忽略 usage 解析错误，继续处理内容
          }

          const chunk = parseSSE(text);
          if (!chunk?.content || chunk.content.length === 0) {
            return;
          }
          const isThinkingChanged = lastIsThinking !== chunk.isThinking;
          lastIsThinking = chunk.isThinking;

          if (chunk.isThinking) {
            if (!isInThinkingMode || isThinkingChanged) {
              isInThinkingMode = true;
              reasoningRemainText += chunk.content;
            } else {
              reasoningRemainText += chunk.content;
            }
          } else {
            if (isInThinkingMode || isThinkingChanged) {
              isInThinkingMode = false;
              thinkingModeEnded = true;
            }
            remainText += chunk.content;
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload); // call fetchEventSource
}

/**
 * 组装文本和图片为 MultimodalContent[]
 */
export function buildMultimodalContent(
  text: string,
  images: string[] = [],
): MultimodalContent[] {
  const result: MultimodalContent[] = [];
  if (text && text.trim()) {
    result.push({ type: "text", text: text.trim() });
  }
  for (const url of images) {
    if (url) {
      result.push({ type: "image_url", image_url: { url } });
    }
  }
  return result;
}
