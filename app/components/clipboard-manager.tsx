"use client";

import { useClipboard } from "../hooks/use-clipboard";
import {
  removeFontSizeProcessor,
  ClipboardProcessor,
} from "../utils/clipboard";

export interface ClipboardManagerProps {
  children?: React.ReactNode;
}

/**
 * 剪贴板管理器组件
 * 用于统一管理和处理剪贴板内容
 */
export function ClipboardManager({ children }: ClipboardManagerProps) {
  // 构建处理器数组
  const processors: ClipboardProcessor[] = [];
  processors.push(removeFontSizeProcessor);

  // 未来可以添加更多处理器
  // if (removeColors) {
  //   processors.push(removeColorsProcessor);
  // }
  // if (customProcessors) {
  //   processors.push(...customProcessors);
  // }

  useClipboard({
    processors,
  });

  return children ? <>{children}</> : null;
}
