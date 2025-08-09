import { useClipboard } from "./use-clipboard";
import { removeFontSizeProcessor } from "../utils/clipboard";

/**
 * 专门移除剪贴板中 font-size 信息的便捷 Hook
 * 这是对通用 useClipboard hook 的封装
 */
export function useClipboardFontSizeRemover() {
  return useClipboard({
    processors: [removeFontSizeProcessor],
  });
}
