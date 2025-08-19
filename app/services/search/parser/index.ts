import { SearchAST, TokenType, ParseError } from "../types";
import { SearchTokenizer } from "./tokenizer";
import { SearchParser } from "./ast-parser";

/**
 * 高级搜索查询解析器 - 主要入口
 */
export class AdvancedSearchParser {
  /**
   * 检测是否为简单查询（只有空格分隔的词汇）
   */
  private static isSimpleQuery(query: string): boolean {
    return !/[|()"：:]/gi.test(query) && !/标题|title/i.test(query);
  }

  /**
   * 快速解析简单查询（性能优化）
   */
  private static parseSimpleQuery(query: string): SearchAST {
    const words = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words.length === 1) {
      return {
        type: "WORD",
        value: words[0],
      };
    } else {
      return {
        type: "AND",
        children: words.map((word) => ({
          type: "WORD",
          value: word,
        })),
      };
    }
  }

  /**
   * 解析搜索查询字符串
   */
  static parse(query: string): SearchAST {
    try {
      if (!query || query.trim().length === 0) {
        throw new ParseError("搜索查询不能为空");
      }

      // 性能优化：简单查询使用快速路径
      if (this.isSimpleQuery(query)) {
        return this.parseSimpleQuery(query);
      }

      // 复杂查询使用完整解析器
      const tokenizer = new SearchTokenizer(query);
      const tokens = tokenizer.tokenize();

      // 过滤掉空白 token
      const filteredTokens = tokens.filter(
        (token) => token.type !== TokenType.WHITESPACE,
      );

      const parser = new SearchParser(filteredTokens);
      return parser.parse();
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }

      throw new ParseError(
        `解析错误: ${error instanceof Error ? error.message : String(error)}`,
        0,
        "请检查搜索语法是否正确",
      );
    }
  }

  /**
   * 验证查询语法（不执行搜索）
   */
  static validate(query: string): { valid: boolean; error?: ParseError } {
    try {
      this.parse(query);
      return { valid: true };
    } catch (error) {
      if (error instanceof ParseError) {
        return { valid: false, error };
      }
      return {
        valid: false,
        error: new ParseError("未知的解析错误"),
      };
    }
  }
}

// 重新导出类型和其他组件
export { SearchTokenizer } from "./tokenizer";
export { SearchParser } from "./ast-parser";
export * from "../types";
