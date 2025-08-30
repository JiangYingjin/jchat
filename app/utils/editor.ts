import { ChatMessage } from "../store";
import {
  getMessageTextContent,
  getMessageTextReasoningContent,
} from "../utils";

/**
 * 选中文本信息接口
 */
export interface SelectedTextInfo {
  anchorText: string;
  extendText: string;
}

/**
 * Monaco Editor 位置信息接口
 */
export interface MonacoPosition {
  lineNumber: number;
  column: number;
}

/**
 * 文本搜索结果接口
 */
export interface TextSearchResult {
  found: boolean;
  index: number;
  searchText: string;
}

/**
 * 用户点击位置信息接口
 */
export interface ClickPositionInfo {
  type: "percentage" | "pixel" | "line";
  value: number; // 百分比(0-100) | 像素值 | 行号
  totalHeight?: number; // 总高度(像素)，用于像素定位
  visibleHeight?: number; // 可视区域高度(像素)，用于像素定位
}

/**
 * 文本匹配位置信息接口
 */
export interface MatchPosition {
  charIndex: number; // 字符索引位置
  lineNumber: number; // 行号
  column: number; // 列号
  relativePosition: number; // 相对位置百分比(0-100)
}

/**
 * 在文本内容中搜索指定文本
 * @param textContent 要搜索的文本内容
 * @param select 选中文本信息
 * @returns 搜索结果
 */
export function searchTextInContent(
  textContent: string,
  select: SelectedTextInfo,
): TextSearchResult {
  const searchText = select.anchorText || select.extendText;

  if (!searchText) {
    return { found: false, index: -1, searchText: "" };
  }

  const searchIndex = textContent.indexOf(searchText);

  return {
    found: searchIndex !== -1,
    index: searchIndex,
    searchText,
  };
}

/**
 * 在文本内容中搜索所有匹配位置
 * @param textContent 要搜索的文本内容
 * @param select 选中文本信息
 * @returns 所有匹配位置的数组
 */
export function findAllTextMatches(
  textContent: string,
  select: SelectedTextInfo,
): MatchPosition[] {
  const searchText = select.anchorText || select.extendText;

  if (!searchText) {
    return [];
  }

  const matches: MatchPosition[] = [];
  let searchIndex = 0;
  const totalLength = textContent.length;

  while (searchIndex < totalLength) {
    const foundIndex = textContent.indexOf(searchText, searchIndex);
    if (foundIndex === -1) break;

    // 转换为Monaco位置
    const position = convertCharIndexToMonacoPosition(textContent, foundIndex);

    // 计算相对位置百分比
    const relativePosition = (foundIndex / totalLength) * 100;

    matches.push({
      charIndex: foundIndex,
      lineNumber: position.lineNumber,
      column: position.column,
      relativePosition,
    });

    // 继续搜索下一个匹配（跳过当前匹配）
    searchIndex = foundIndex + searchText.length;
  }

  return matches;
}

/**
 * 将文本字符位置转换为 Monaco Editor 的行/列位置
 * @param textContent 完整的文本内容
 * @param charIndex 字符位置索引
 * @returns Monaco 编辑器位置
 */
export function convertCharIndexToMonacoPosition(
  textContent: string,
  charIndex: number,
): MonacoPosition {
  const contentBeforePosition = textContent.substring(0, charIndex);
  const lineNumber = contentBeforePosition.split("\n").length;
  const lineStart = contentBeforePosition.lastIndexOf("\n") + 1;
  const column = charIndex - lineStart + 1;

  return {
    lineNumber,
    column,
  };
}

/**
 * 将点击位置转换为相对百分比
 * @param clickPosition 点击位置信息
 * @param totalLines 编辑器总行数
 * @returns 相对百分比(0-100)
 */
export function convertClickPositionToPercentage(
  clickPosition: ClickPositionInfo,
  totalLines: number,
): number {
  switch (clickPosition.type) {
    case "percentage":
      return Math.max(0, Math.min(100, clickPosition.value));

    case "pixel":
      // 需要总高度和可视高度来计算
      if (clickPosition.totalHeight && clickPosition.visibleHeight) {
        const scrollTop = clickPosition.value;
        const totalHeight = clickPosition.totalHeight;
        const visibleHeight = clickPosition.visibleHeight;
        // 计算点击位置在文档中的相对位置
        const clickRatio = scrollTop / (totalHeight - visibleHeight);
        return Math.max(0, Math.min(100, clickRatio * 100));
      }
      return 50; // 默认中位

    case "line":
      if (totalLines <= 0) return 0;
      return Math.max(
        0,
        Math.min(100, (clickPosition.value / totalLines) * 100),
      );

    default:
      return 50; // 默认中位
  }
}

/**
 * 根据点击位置找到最接近的匹配
 * @param matches 所有匹配位置
 * @param clickPercentage 点击位置的相对百分比(0-100)
 * @returns 最接近的匹配位置，如果没有匹配则返回null
 */
export function findClosestMatchByClickPosition(
  matches: MatchPosition[],
  clickPercentage: number,
): MatchPosition | null {
  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // 找到距离点击位置百分比最近的匹配
  let closestMatch = matches[0];
  let minDistance = Math.abs(matches[0].relativePosition - clickPercentage);

  for (let i = 1; i < matches.length; i++) {
    const distance = Math.abs(matches[i].relativePosition - clickPercentage);
    if (distance < minDistance) {
      minDistance = distance;
      closestMatch = matches[i];
    }
  }

  return closestMatch;
}

/**
 * 获取消息的文本内容
 * @param message 消息对象
 * @param messageType 消息内容类型
 * @returns 文本内容
 */
export function getMessageContent(
  message: ChatMessage,
  messageType: "content" | "reasoningContent",
): string {
  return messageType === "content"
    ? getMessageTextContent(message)
    : getMessageTextReasoningContent(message);
}

/**
 * 在 Monaco Editor 中应用定位
 * 注意：不执行滚动操作，滚动由调用者统一处理以避免冲突
 * @param editor Monaco Editor 实例
 * @param position 要定位到的位置
 */
export function applyEditorPosition(
  editor: any,
  position: MonacoPosition,
): void {
  console.log("📍 [DEBUG] applyEditorPosition:", {
    lineNumber: position.lineNumber,
    column: position.column,
    timestamp: performance.now(),
  });

  // 只设置光标位置，不执行滚动操作
  // 滚动操作由调用者统一处理，避免重复滚动导致的冲突
  editor.setPosition(position);
  editor.focus();

  // 🔥 修复：移除 editor.revealPositionInCenter(position);
  // 避免与handleMonacoMount中的滚动冲突
}

/**
 * 默认聚焦到编辑器
 * @param editor Monaco Editor 实例
 */
export function focusEditor(editor: any): void {
  editor.focus();
}

/**
 * 智能定位函数 - 在Monaco Editor中定位到指定的文本位置
 * @param editor Monaco Editor实例
 * @param select 选中文本信息
 * @param messageType 消息内容类型 ("content" | "reasoningContent")
 * @param message 消息对象
 * @param clickPosition 用户点击位置信息（可选，用于智能选择匹配位置）
 */
export function smartPositionInEditor(
  editor: any,
  select: SelectedTextInfo,
  messageType: "content" | "reasoningContent",
  message: ChatMessage,
  clickPosition?: ClickPositionInfo,
): void {
  // 获取搜索文本
  const searchResult = searchTextInContent("", select);

  // 如果没有搜索文本，默认聚焦
  if (!searchResult.searchText) {
    focusEditor(editor);
    return;
  }

  // 获取消息文本内容
  const textContent = getMessageContent(message, messageType);

  // 查找所有匹配位置
  const allMatches = findAllTextMatches(textContent, select);

  // 如果没有找到任何匹配，默认聚焦
  if (allMatches.length === 0) {
    focusEditor(editor);
    return;
  }

  let targetMatch: MatchPosition;

  // 如果提供了点击位置信息，使用智能匹配算法
  if (clickPosition) {
    // 获取编辑器总行数用于位置转换
    const totalLines = editor.getModel()?.getLineCount() || 1;
    const clickPercentage = convertClickPositionToPercentage(
      clickPosition,
      totalLines,
    );

    // 找到最接近点击位置的匹配
    const closestMatch = findClosestMatchByClickPosition(
      allMatches,
      clickPercentage,
    );

    if (closestMatch) {
      targetMatch = closestMatch;
    } else {
      // 如果没有找到最接近的匹配，使用第一个
      targetMatch = allMatches[0];
    }
  } else {
    // 如果没有点击位置信息，使用第一个匹配（保持向后兼容）
    targetMatch = allMatches[0];
  }

  // 转换位置并应用
  const position: MonacoPosition = {
    lineNumber: targetMatch.lineNumber,
    column: targetMatch.column,
  };

  // 应用光标位置（不包含滚动）
  applyEditorPosition(editor, position);

  // 🔥 修复：在智能定位后执行滚动操作
  // 使用延迟确保光标设置完成后再滚动
  requestAnimationFrame(() => {
    try {
      console.log("🎯 [DEBUG] 智能定位后滚动:", {
        lineNumber: targetMatch.lineNumber,
        column: targetMatch.column,
        timestamp: performance.now(),
      });

      // 滚动到光标位置
      editor.revealPositionInCenter({
        lineNumber: targetMatch.lineNumber,
        column: targetMatch.column,
      });

      // 验证滚动结果
      setTimeout(() => {
        const scrollTop = editor.getScrollTop();
        const currentPosition = editor.getPosition();
        console.log("✅ [DEBUG] 智能定位滚动完成:", {
          scrollTop: scrollTop,
          currentPosition: currentPosition
            ? `${currentPosition.lineNumber}:${currentPosition.column}`
            : "null",
          timestamp: performance.now(),
        });
      }, 50);
    } catch (error) {
      console.error("❌ [DEBUG] 智能定位滚动失败:", error);
    }
  });
}

/**
 * 创建智能定位回调函数的工厂函数
 * @param select 选中文本信息
 * @param messageType 消息内容类型
 * @param message 消息对象
 * @param clickPosition 用户点击位置信息（可选）
 * @returns 返回可以传递给Monaco Editor的智能定位回调函数
 */
export function createSmartPositionCallback(
  select: SelectedTextInfo,
  messageType: "content" | "reasoningContent",
  message: ChatMessage,
  clickPosition?: ClickPositionInfo,
) {
  return (editor: any) => {
    smartPositionInEditor(editor, select, messageType, message, clickPosition);
  };
}

/**
 * 创建带有点击位置捕获的智能定位回调函数
 * @param select 选中文本信息
 * @param messageType 消息内容类型
 * @param message 消息对象
 * @param getClickPosition 获取点击位置的函数
 * @returns 返回可以传递给Monaco Editor的智能定位回调函数
 */
export function createSmartPositionCallbackWithClickCapture(
  select: SelectedTextInfo,
  messageType: "content" | "reasoningContent",
  message: ChatMessage,
  getClickPosition?: () => ClickPositionInfo | undefined,
) {
  return (editor: any) => {
    const clickPosition = getClickPosition ? getClickPosition() : undefined;
    smartPositionInEditor(editor, select, messageType, message, clickPosition);
  };
}

// ================ 使用说明 ================

/*
智能定位功能使用指南：

1. 基础用法（保持向后兼容）：
   const callback = createSmartPositionCallback(select, messageType, message);
   // 这会定位到第一个匹配位置

2. 带点击位置的智能定位：
   const clickPosition = { type: "percentage", value: 30 }; // 点击位置在30%
   const callback = createSmartPositionCallback(select, messageType, message, clickPosition);

3. 动态获取点击位置：
   const getClickPosition = () => ({ type: "percentage", value: getCurrentClickPercentage() });
   const callback = createSmartPositionCallbackWithClickCapture(select, messageType, message, getClickPosition);

4. 点击位置类型：
   - percentage: 直接使用百分比 (0-100)
   - pixel: 使用像素值，需要提供totalHeight和visibleHeight
   - line: 使用行号，需要编辑器总行数

5. 工作原理：
   - 当搜索文本出现多次时，函数会找到所有匹配位置
   - 根据用户点击位置计算最接近的匹配
   - 自动定位到最合适的匹配位置

示例：
假设文本中有3个"test"单词，分别在位置10%、40%、80%
- 如果用户在编辑器20%位置点击，会定位到40%的"test"
- 如果用户在编辑器70%位置点击，会定位到80%的"test"
*/
