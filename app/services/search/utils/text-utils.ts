/**
 * 文本处理工具函数
 */

/**
 * 标准化输入文本，处理全角/半角符号
 */
export function normalizeText(input: string): string {
  return input
    .replace(/：/g, ":") // 全角冒号 -> 半角冒号
    .replace(/（/g, "(") // 全角左括号 -> 半角左括号
    .replace(/）/g, ")") // 全角右括号 -> 半角右括号
    .replace(/｜/g, "|") // 全角竖线 -> 半角竖线
    .replace(/"/g, '"') // 全角左引号 -> 半角引号
    .replace(/"/g, '"') // 全角右引号 -> 半角引号
    .trim();
}

/**
 * 清理文本：换行替换为空格，连续空格合并
 */
export function cleanText(text: string): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 计算字符显示长度（中文字符 vs 英文字符）
 */
export function getDisplayLength(char: string): number {
  if (/[\u4e00-\u9fff]/.test(char)) {
    return 1; // 中文字符
  } else if (/[a-zA-Z0-9]/.test(char)) {
    return 0.5; // 英文字母和数字
  }
  return 0; // 空格等忽略
}

/**
 * 在文本中查找匹配的词汇
 */
export function findMatchedTerms(
  text: string,
  candidateTerms: string[],
  caseSensitive: boolean = false,
): string[] {
  const matchedTerms: string[] = [];
  const searchText = caseSensitive ? text : text.toLowerCase();

  for (const term of candidateTerms) {
    const searchTerm = caseSensitive ? term : term.toLowerCase();
    if (searchText.includes(searchTerm)) {
      matchedTerms.push(term);
    }
  }

  return matchedTerms;
}

/**
 * 检查文本是否包含任一词汇
 */
export function containsAnyTerm(
  text: string,
  terms: string[],
  caseSensitive: boolean = false,
): boolean {
  const searchText = caseSensitive ? text : text.toLowerCase();

  return terms.some((term) => {
    const searchTerm = caseSensitive ? term : term.toLowerCase();
    return searchText.includes(searchTerm);
  });
}

/**
 * 检查文本是否包含所有词汇
 */
export function containsAllTerms(
  text: string,
  terms: string[],
  caseSensitive: boolean = false,
): boolean {
  const searchText = caseSensitive ? text : text.toLowerCase();

  return terms.every((term) => {
    const searchTerm = caseSensitive ? term : term.toLowerCase();
    return searchText.includes(searchTerm);
  });
}
