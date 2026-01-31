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
import { RequestPayload } from "@/app/client/openai";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";

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

export async function convertImageUrlsToBase64(
  content: RequestMessage["content"],
) {
  if (typeof content === "string") {
    return content;
  }
  const result: MultimodalContent[] = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await cacheImageToBase64Image(part?.image_url?.url);
        result.push({ type: part.type, image_url: { url } });
      } catch (error) {
        console.error("Error processing image URL:", error);
        // 分享场景：单图失败则跳过，不写入
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

/**
 * 为分享链接构建系统提示词 content：text + images（每张图转 base64，失败则跳过）
 */
export async function buildSystemContentForShare(data: {
  text: string;
  images: string[];
}): Promise<string | MultimodalContent[]> {
  const parts: MultimodalContent[] = [];
  if (data.text?.trim()) {
    parts.push({ type: "text", text: data.text.trim() });
  }
  for (const url of data.images ?? []) {
    try {
      const dataUrl = await cacheImageToBase64Image(url);
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch {
      // 单图失败则跳过
    }
  }
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0].type === "text")
    return parts[0].text ?? "";
  return parts;
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

export function stream(
  chatPath: string,
  requestPayload: RequestPayload,
  headers: any,
  controller: AbortController,
  extractStreamData: (text: string) => {
    content: string;
    isReasoning: boolean;
  },
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let reasoningResponseText = "";
  let reasoningRemainText = "";
  let finished = false;
  let responseRes: Response;
  let isInReasoningMode = false;
  let lastIsReasoning = false;
  let reasoningModeEnded = false;
  let usageInfo:
    | {
        completion_tokens?: number;
        prompt_tokens?: number;
        cost?: number;
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
      options.onUpdate?.(responseText, fetchText, usageInfo);
    }

    if (reasoningModeEnded && reasoningRemainText.length > 0) {
      // 这种情况下 reasoning 内容应该已经在消息处理时立即输出了
      // 但以防万一，这里也处理一下剩余内容
      reasoningResponseText += reasoningRemainText;
      reasoningResponseText = reasoningResponseText.replace(/^\s*\n/gm, "");
      const remainingReasoning = reasoningRemainText;
      reasoningRemainText = "";
      options.onReasoningUpdate?.(
        reasoningResponseText,
        remainingReasoning,
        usageInfo,
      );
      reasoningModeEnded = false;
    } else if (reasoningRemainText.length > 0) {
      const fetchCount = Math.max(
        1,
        Math.round(reasoningRemainText.length / 60),
      );
      const fetchText = reasoningRemainText.slice(0, fetchCount);
      reasoningResponseText += fetchText;
      reasoningResponseText = reasoningResponseText.replace(/^\s*\n/gm, "");
      reasoningRemainText = reasoningRemainText.slice(fetchCount);
      options.onReasoningUpdate?.(reasoningResponseText, fetchText, usageInfo);
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
              // console.log("[Usage Info]", usageInfo);
            }
          } catch (usageParseError) {
            // 忽略 usage 解析错误，继续处理内容
          }

          const chunk = extractStreamData(text);
          if (!chunk?.content || chunk.content.length === 0) {
            return;
          }
          const isReasoningChanged = lastIsReasoning !== chunk.isReasoning;
          lastIsReasoning = chunk.isReasoning;

          if (chunk.isReasoning) {
            if (!isInReasoningMode || isReasoningChanged) {
              isInReasoningMode = true;
              reasoningRemainText += chunk.content;
            } else {
              reasoningRemainText += chunk.content;
            }
          } else {
            if (isInReasoningMode || isReasoningChanged) {
              // 立即输出所有剩余的 reasoning 内容，避免被截断
              if (reasoningRemainText.length > 0) {
                reasoningResponseText += reasoningRemainText;
                reasoningResponseText = reasoningResponseText.replace(
                  /^\s*\n/gm,
                  "",
                );
                const remainingReasoning = reasoningRemainText;
                reasoningRemainText = "";
                options.onReasoningUpdate?.(
                  reasoningResponseText,
                  remainingReasoning,
                );
              }
              isInReasoningMode = false;
              reasoningModeEnded = true;
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
  const mContent: MultimodalContent[] = [];
  if (text && text.trim()) mContent.push({ type: "text", text: text.trim() });
  for (const url of images)
    if (url) mContent.push({ type: "image_url", image_url: { url } });
  return mContent;
}
