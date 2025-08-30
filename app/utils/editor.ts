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
 * @param editor Monaco Editor 实例
 * @param position 要定位到的位置
 */
export function applyEditorPosition(
  editor: any,
  position: MonacoPosition,
): void {
  editor.setPosition(position);
  editor.focus();
  editor.revealPositionInCenter(position);
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
 */
export function smartPositionInEditor(
  editor: any,
  select: SelectedTextInfo,
  messageType: "content" | "reasoningContent",
  message: ChatMessage,
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

  // 重新搜索以获取准确位置（因为之前传入了空字符串）
  const actualSearchResult = searchTextInContent(textContent, select);

  // 如果找不到搜索文本，默认聚焦
  if (!actualSearchResult.found) {
    focusEditor(editor);
    return;
  }

  // 转换位置并应用
  const position = convertCharIndexToMonacoPosition(
    textContent,
    actualSearchResult.index,
  );
  applyEditorPosition(editor, position);
}

/**
 * 创建智能定位回调函数的工厂函数
 * @param select 选中文本信息
 * @param messageType 消息内容类型
 * @param message 消息对象
 * @returns 返回可以传递给Monaco Editor的智能定位回调函数
 */
export function createSmartPositionCallback(
  select: SelectedTextInfo,
  messageType: "content" | "reasoningContent",
  message: ChatMessage,
) {
  return (editor: any) => {
    smartPositionInEditor(editor, select, messageType, message);
  };
}
