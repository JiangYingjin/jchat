import { useEffect, useCallback, useState } from "react";
import {
  writeToClipboard,
  ClipboardProcessor,
  applyProcessors,
} from "../utils/clipboard";

export interface ClipboardOptions {
  processors?: ClipboardProcessor[];
}

/**
 * 通用剪贴板处理 Hook
 * 支持自定义处理器来处理剪贴板内容
 */
export function useClipboard(options: ClipboardOptions = {}) {
  const { processors = [] } = options;
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCopy = useCallback(
    async (event: ClipboardEvent) => {
      if (!event.clipboardData || processors.length === 0) return;

      setIsProcessing(true);

      setTimeout(async () => {
        try {
          const clipboardItems = await navigator.clipboard.read();
          if (clipboardItems.length === 0) return;

          const clipboardItem = clipboardItems[0];
          let textContent = "";

          if (clipboardItem.types.includes("text/plain")) {
            const textBlob = await clipboardItem.getType("text/plain");
            textContent = await textBlob.text();
          }

          if (clipboardItem.types.includes("text/html")) {
            const htmlBlob = await clipboardItem.getType("text/html");
            const originalHtml = await htmlBlob.text();

            // 应用所有处理器
            const processedHtml = applyProcessors(originalHtml, processors);

            if (processedHtml !== originalHtml) {
              await writeToClipboard(textContent, processedHtml);
            }
          }
        } catch (error) {
          // 静默处理错误
        } finally {
          setIsProcessing(false);
        }
      }, 50);
    },
    [processors],
  );

  useEffect(() => {
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [handleCopy]);

  return { isProcessing };
}
