/**
 * Monaco Editor 工具函数
 * 包含统计信息更新、文本处理等通用功能
 */

/**
 * 更新文本统计信息
 */
export const updateStats = (text: string | undefined) => {
  // 安全检查：确保text是有效字符串
  if (typeof text !== "string") {
    return { characters: 0, lines: 0, words: 0 };
  }

  try {
    const characters = text.length;
    const lines = text.split("\n").length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { characters, lines, words };
  } catch (error) {
    return { characters: 0, lines: 0, words: 0 };
  }
};

/**
 * 安全的文本处理
 */
export const safeTextValue = (value: any): string => {
  return typeof value === "string" ? value : "";
};

/**
 * 检查组件是否仍然挂载
 */
export const isComponentMounted = (
  isMounted: boolean,
  isDisposed: boolean,
): boolean => {
  return isMounted && !isDisposed;
};

/**
 * 延迟执行函数
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * 安全聚焦编辑器
 */
export const safeFocusEditor = (
  editorInstance: any,
  isDisposed: boolean,
  callback?: () => void,
) => {
  if (!editorInstance || isDisposed) return false;

  try {
    const domNode = editorInstance.getDomNode();
    if (domNode && domNode.offsetHeight > 0 && domNode.offsetWidth > 0) {
      editorInstance.focus();
      callback?.();
      return true;
    }
  } catch (error) {
    // 忽略聚焦错误
  }
  return false;
};
