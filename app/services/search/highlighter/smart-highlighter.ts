import { HighlightType, HighlightSegment, HighlightOptions } from "../types";

/**
 * 智能高亮器类
 */
export class SmartHighlighter {
  private options: Required<HighlightOptions>;

  constructor(options: HighlightOptions = {}) {
    this.options = {
      caseSensitive: false,
      maxContextLength: 56,
      leftContextChars: 16,
      rightContextChars: 40,
      ...options,
    };
  }

  /**
   * 主要高亮方法：使用匹配词列表进行智能高亮
   * @param text 要高亮的文本
   * @param matchedTerms 实际匹配的词汇列表（来自搜索引擎）
   * @param contextType 上下文类型（title/message/system）
   * @returns 高亮片段数组
   */
  highlight(
    text: string,
    matchedTerms: string[] = [],
    contextType: "title" | "message" | "system" = "message",
  ): HighlightSegment[] {
    if (!text || matchedTerms.length === 0) {
      return [{ text, isHighlighted: false }];
    }

    return this.highlightWithTerms(text, matchedTerms, contextType);
  }

  /**
   * 使用匹配词列表进行高亮
   */
  private highlightWithTerms(
    text: string,
    terms: string[],
    contextType: "title" | "message" | "system",
  ): HighlightSegment[] {
    if (!terms.length) {
      return [{ text, isHighlighted: false }];
    }

    // 查找所有匹配位置
    const matches = this.findAllMatches(text, terms);

    if (matches.length === 0) {
      return [{ text, isHighlighted: false }];
    }

    // 根据上下文类型调整截取策略
    const processedText = this.applyContextStrategy(text, matches, contextType);

    // 构建高亮片段
    return this.buildHighlightSegments(
      processedText.text,
      processedText.matches,
    );
  }

  /**
   * 查找文本中所有匹配位置
   */
  private findAllMatches(
    text: string,
    terms: string[],
  ): Array<{
    start: number;
    end: number;
    term: string;
    type: HighlightType;
  }> {
    const matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }> = [];

    const searchText = this.options.caseSensitive ? text : text.toLowerCase();

    for (const term of terms) {
      const searchTerm = this.options.caseSensitive ? term : term.toLowerCase();

      // 转义特殊字符
      const escapedTerm = this.escapeRegExp(searchTerm);
      const regex = new RegExp(
        escapedTerm,
        this.options.caseSensitive ? "g" : "gi",
      );

      let match;
      while ((match = regex.exec(searchText)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          term: term,
          type: this.determineHighlightType(term),
        });
      }
    }

    // 按位置排序并合并重叠区域
    return this.mergeOverlappingMatches(matches);
  }

  /**
   * 确定高亮类型
   */
  private determineHighlightType(term: string): HighlightType {
    // 如果包含空格，可能是精确匹配的短语
    if (term.includes(" ")) {
      return HighlightType.EXACT;
    }

    // 单个词汇
    return HighlightType.WORD;
  }

  /**
   * 合并重叠的匹配区域
   */
  private mergeOverlappingMatches(
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>,
  ): Array<{
    start: number;
    end: number;
    term: string;
    type: HighlightType;
  }> {
    if (matches.length <= 1) return matches;

    // 按开始位置排序
    matches.sort((a, b) => a.start - b.start);

    const merged = [matches[0]];

    for (let i = 1; i < matches.length; i++) {
      const current = matches[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        // 重叠，合并
        last.end = Math.max(last.end, current.end);
        // 合并词汇，保持唯一性
        if (!last.term.includes(current.term)) {
          last.term = `${last.term} ${current.term}`;
        }
        // 优先级：EXACT > WORD > PARTIAL
        if (
          current.type === HighlightType.EXACT ||
          (current.type === HighlightType.WORD &&
            last.type === HighlightType.PARTIAL)
        ) {
          last.type = current.type;
        }
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * 根据上下文类型应用不同的截取策略
   */
  private applyContextStrategy(
    text: string,
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>,
    contextType: "title" | "message" | "system",
  ): {
    text: string;
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>;
  } {
    // 标题不截取，直接返回
    if (contextType === "title") {
      return { text, matches };
    }

    // 消息和系统消息需要智能截取
    return this.smartTruncateWithMatches(text, matches);
  }

  /**
   * 智能截取文本，保留匹配词周围的上下文
   */
  private smartTruncateWithMatches(
    text: string,
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>,
  ): {
    text: string;
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>;
  } {
    if (matches.length === 0) {
      return { text: this.simpleTextTruncate(text), matches: [] };
    }

    // 预处理：换行替换为空格，连续空格合并
    const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    // 找到最重要的匹配（通常是第一个）
    const primaryMatch = matches[0];

    // 计算截取范围
    const { startIndex, endIndex } = this.calculateTruncateRange(
      cleanText,
      primaryMatch.start,
      primaryMatch.end,
    );

    // 截取文本
    let truncatedText = cleanText.slice(startIndex, endIndex);

    // 添加省略号
    if (startIndex > 0) {
      truncatedText = "..." + truncatedText;
    }
    if (endIndex < cleanText.length) {
      truncatedText = truncatedText + "...";
    }

    // 调整匹配位置
    const offset = startIndex - (startIndex > 0 ? 3 : 0); // 考虑省略号的偏移
    const adjustedMatches = matches
      .filter((match) => match.start >= startIndex && match.end <= endIndex)
      .map((match) => ({
        ...match,
        start: match.start - offset,
        end: match.end - offset,
      }));

    return {
      text: truncatedText,
      matches: adjustedMatches,
    };
  }

  /**
   * 计算截取范围
   */
  private calculateTruncateRange(
    text: string,
    matchStart: number,
    matchEnd: number,
  ): { startIndex: number; endIndex: number } {
    const leftChars = this.options.leftContextChars;
    const rightChars = this.options.rightContextChars;

    // 向前寻找起始位置
    let startIndex = matchStart;
    let beforeLength = 0;
    for (let i = matchStart - 1; i >= 0 && beforeLength < leftChars; i--) {
      const charLength = this.getDisplayLength(text[i]);
      if (beforeLength + charLength > leftChars) break;
      beforeLength += charLength;
      startIndex = i;
    }

    // 向后寻找结束位置
    let endIndex = matchEnd;
    let afterLength = 0;
    for (let i = matchEnd; i < text.length && afterLength < rightChars; i++) {
      const charLength = this.getDisplayLength(text[i]);
      if (afterLength + charLength > rightChars) break;
      afterLength += charLength;
      endIndex = i + 1;
    }

    return { startIndex, endIndex };
  }

  /**
   * 构建高亮片段
   */
  private buildHighlightSegments(
    text: string,
    matches: Array<{
      start: number;
      end: number;
      term: string;
      type: HighlightType;
    }>,
  ): HighlightSegment[] {
    if (matches.length === 0) {
      return [{ text, isHighlighted: false }];
    }

    const segments: HighlightSegment[] = [];
    let currentPos = 0;

    for (const match of matches) {
      // 添加匹配前的文本
      if (currentPos < match.start) {
        segments.push({
          text: text.slice(currentPos, match.start),
          isHighlighted: false,
        });
      }

      // 添加高亮文本
      segments.push({
        text: text.slice(match.start, match.end),
        isHighlighted: true,
        highlightType: match.type,
        originalTerm: match.term,
      });

      currentPos = match.end;
    }

    // 添加剩余文本
    if (currentPos < text.length) {
      segments.push({
        text: text.slice(currentPos),
        isHighlighted: false,
      });
    }

    return segments;
  }

  /**
   * 简单文本截取（无匹配时使用）
   */
  private simpleTextTruncate(text: string): string {
    const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const maxLength = this.options.maxContextLength;

    if (cleanText.length <= maxLength) {
      return cleanText;
    }

    let result = "";
    let currentLength = 0;

    for (const char of cleanText) {
      const charLength = this.getDisplayLength(char);
      if (currentLength + charLength > maxLength) break;
      result += char;
      currentLength += charLength;
    }

    return result + "...";
  }

  /**
   * 计算字符显示长度
   */
  private getDisplayLength(char: string): number {
    if (/[\u4e00-\u9fff]/.test(char)) {
      return 1; // 中文字符
    } else if (/[a-zA-Z0-9]/.test(char)) {
      return 0.5; // 英文字母和数字
    }
    return 0; // 空格等忽略
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 将高亮片段转换为Markdown格式（向后兼容）
   */
  static segmentsToMarkdown(segments: HighlightSegment[]): string {
    return segments
      .map((segment) =>
        segment.isHighlighted ? `**${segment.text}**` : segment.text,
      )
      .join("");
  }

  /**
   * 快速高亮方法（简化接口）
   */
  static quickHighlight(
    text: string,
    matchedTerms: string[],
    options?: HighlightOptions,
  ): HighlightSegment[] {
    const highlighter = new SmartHighlighter(options);
    return highlighter.highlight(text, matchedTerms);
  }
}
