/**
 * 剪贴板内容处理器类型
 */
export type ClipboardProcessor = (html: string) => string;

/**
 * 移除 HTML 字符串中所有的 font-size 样式信息的处理器
 */
export const removeFontSizeProcessor: ClipboardProcessor = (
  htmlString: string,
): string => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    const elementsWithStyle = doc.querySelectorAll("[style]");

    elementsWithStyle.forEach((element) => {
      const currentStyle = element.getAttribute("style");
      if (currentStyle?.includes("font-size")) {
        const cleanedStyle = currentStyle
          .replace(/font-size\s*:\s*[^;]+;?/gi, "")
          .replace(/;\s*;/g, ";")
          .replace(/^\s*;|;\s*$/g, "")
          .trim();

        if (cleanedStyle) {
          element.setAttribute("style", cleanedStyle);
        } else {
          element.removeAttribute("style");
        }
      }
    });

    return doc.body?.innerHTML || htmlString;
  } catch (error) {
    return htmlString;
  }
};

/**
 * 应用处理器处理 HTML 内容
 */
export function applyProcessors(
  html: string,
  processors: ClipboardProcessor[],
): string {
  return processors.reduce((content, processor) => processor(content), html);
}

/**
 * 将内容写入剪贴板
 */
export async function writeToClipboard(text: string, html?: string) {
  try {
    const items: Record<string, Blob> = {
      "text/plain": new Blob([text], { type: "text/plain" }),
    };
    if (html) {
      items["text/html"] = new Blob([html], { type: "text/html" });
    }
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch (error) {
    // 备用方法
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
  }
}

// 兼容性导出 - 保持向后兼容
export const removeFontSizeFromHtml = removeFontSizeProcessor;
