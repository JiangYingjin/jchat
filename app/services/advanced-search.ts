/**
 * 高级搜索解析器
 * 支持复杂的搜索语法：AND、OR、括号、精确匹配、标题限定
 */

// Token 类型枚举
export enum TokenType {
  WORD = "WORD", // 普通词汇
  QUOTED = "QUOTED", // "引号内容"
  TITLE_PREFIX = "TITLE_PREFIX", // 标题:
  OR_OPERATOR = "OR_OPERATOR", // |
  LEFT_PAREN = "LEFT_PAREN", // (
  RIGHT_PAREN = "RIGHT_PAREN", // )
  WHITESPACE = "WHITESPACE", // 空格
  EOF = "EOF", // 结束标记
}

// Token 接口
export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// AST 节点类型
export type SearchASTType = "AND" | "OR" | "TITLE" | "EXACT" | "WORD";

// AST 节点接口
export interface SearchAST {
  type: SearchASTType;
  value?: string;
  children?: SearchAST[];
  position?: number;
}

// 解析错误类
export class ParseError extends Error {
  position: number;
  suggestion: string;

  constructor(message: string, position: number = 0, suggestion: string = "") {
    super(message);
    this.name = "ParseError";
    this.position = position;
    this.suggestion = suggestion;
  }
}

/**
 * 词法分析器 - 将输入字符串转换为 Token 流
 */
export class SearchTokenizer {
  private input: string;
  private position: number = 0;
  private tokens: Token[] = [];

  constructor(input: string) {
    const originalInput = input;
    this.input = this.normalizeInput(input);

    // 移除标准化日志，减少控制台输出
  }

  /**
   * 标准化输入，处理全角/半角符号
   */
  private normalizeInput(input: string): string {
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
   * 主要的分词方法
   */
  tokenize(): Token[] {
    this.tokens = [];
    this.position = 0;

    while (this.position < this.input.length) {
      this.skipWhitespace();

      if (this.position >= this.input.length) break;

      const char = this.input[this.position];
      const startPos = this.position;

      switch (char) {
        case "(":
          this.tokens.push({
            type: TokenType.LEFT_PAREN,
            value: "(",
            position: startPos,
          });
          this.position++;
          break;

        case ")":
          this.tokens.push({
            type: TokenType.RIGHT_PAREN,
            value: ")",
            position: startPos,
          });
          this.position++;
          break;

        case "|":
          this.tokens.push({
            type: TokenType.OR_OPERATOR,
            value: "|",
            position: startPos,
          });
          this.position++;
          break;

        case '"':
          this.parseQuotedString(startPos);
          break;

        default:
          this.parseWordOrTitle(startPos);
          break;
      }
    }

    // 添加 EOF 标记
    this.tokens.push({
      type: TokenType.EOF,
      value: "",
      position: this.position,
    });

    return this.tokens;
  }

  /**
   * 跳过空白字符
   */
  private skipWhitespace(): void {
    while (
      this.position < this.input.length &&
      /\s/.test(this.input[this.position])
    ) {
      this.position++;
    }
  }

  /**
   * 解析引号字符串
   */
  private parseQuotedString(startPos: number): void {
    this.position++; // 跳过开始引号
    let value = "";

    while (
      this.position < this.input.length &&
      this.input[this.position] !== '"'
    ) {
      value += this.input[this.position];
      this.position++;
    }

    if (this.position >= this.input.length) {
      throw new ParseError(
        "未闭合的引号",
        startPos,
        '请确保引号成对出现，如："搜索内容"',
      );
    }

    this.position++; // 跳过结束引号

    this.tokens.push({
      type: TokenType.QUOTED,
      value: value,
      position: startPos,
    });
  }

  /**
   * 解析普通词汇或标题前缀
   */
  private parseWordOrTitle(startPos: number): void {
    let value = "";

    while (
      this.position < this.input.length &&
      !/[\s()|":]/.test(this.input[this.position]) // 只检查半角冒号，因为已经标准化了
    ) {
      value += this.input[this.position];
      this.position++;
    }

    if (value.length === 0) {
      return;
    }

    // 检查当前字符是否为冒号（经过标准化后只会是半角）
    if (
      this.position < this.input.length &&
      this.input[this.position] === ":"
    ) {
      // 检查是否为标题前缀
      if (value === "标题" || value.toLowerCase() === "title") {
        // 跳过冒号
        this.position++;

        this.tokens.push({
          type: TokenType.TITLE_PREFIX,
          value: value,
          position: startPos,
        });
        return;
      }
    }

    // 检查是否为旧格式的标题前缀（直接包含冒号）
    if (value.endsWith(":")) {
      const titleKeyword = value.slice(0, -1);
      if (titleKeyword === "标题" || titleKeyword.toLowerCase() === "title") {
        this.tokens.push({
          type: TokenType.TITLE_PREFIX,
          value: titleKeyword,
          position: startPos,
        });
        return;
      }
    }

    // 普通词汇
    this.tokens.push({
      type: TokenType.WORD,
      value: value,
      position: startPos,
    });
  }
}

/**
 * 语法分析器 - 将 Token 流转换为 AST
 * 使用递归下降解析法，按照优先级解析
 */
export class SearchParser {
  private tokens: Token[];
  private current: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /**
   * 解析完整表达式
   */
  parse(): SearchAST {
    const result = this.parseOrExpression();

    if (!this.isAtEnd()) {
      const currentToken = this.peek();
      throw new ParseError(
        `意外的符号: ${currentToken.value}`,
        currentToken.position,
        "请检查搜索语法是否正确",
      );
    }

    return result;
  }

  /**
   * 解析 OR 表达式 (最低优先级)
   */
  private parseOrExpression(): SearchAST {
    let left = this.parseAndExpression();

    while (this.match(TokenType.OR_OPERATOR)) {
      const children = [left];
      children.push(this.parseAndExpression());

      // 继续收集 OR 操作数
      while (this.match(TokenType.OR_OPERATOR)) {
        children.push(this.parseAndExpression());
      }

      left = {
        type: "OR",
        children: children,
      };
    }

    return left;
  }

  /**
   * 解析 AND 表达式 (空格表示 AND)
   */
  private parseAndExpression(): SearchAST {
    let left = this.parsePrimary();

    // 连续的非 OR 操作符表示 AND
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.OR_OPERATOR) &&
      !this.check(TokenType.RIGHT_PAREN)
    ) {
      const right = this.parsePrimary();

      if (left.type === "AND") {
        left.children!.push(right);
      } else {
        left = {
          type: "AND",
          children: [left, right],
        };
      }
    }

    return left;
  }

  /**
   * 解析基础表达式 (最高优先级)
   */
  private parsePrimary(): SearchAST {
    // 处理括号
    if (this.match(TokenType.LEFT_PAREN)) {
      const expr = this.parseOrExpression();
      this.consume(TokenType.RIGHT_PAREN, '缺少右括号 ")"');
      return expr;
    }

    // 处理标题前缀
    if (this.match(TokenType.TITLE_PREFIX)) {
      const titleExpr = this.parsePrimary();
      return {
        type: "TITLE",
        children: [titleExpr],
      };
    }

    // 处理引号字符串
    if (this.match(TokenType.QUOTED)) {
      const token = this.previous();
      return {
        type: "EXACT",
        value: token.value,
        position: token.position,
      };
    }

    // 处理普通词汇
    if (this.match(TokenType.WORD)) {
      const token = this.previous();
      return {
        type: "WORD",
        value: token.value,
        position: token.position,
      };
    }

    const currentToken = this.peek();
    throw new ParseError(
      `意外的符号: ${currentToken.value}`,
      currentToken.position,
      "请检查搜索语法",
    );
  }

  // 辅助方法
  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();

    const currentToken = this.peek();
    throw new ParseError(message, currentToken.position);
  }
}

/**
 * 高级搜索查询解析器 - 主要入口
 */
export class AdvancedSearchParser {
  /**
   * 检测是否为简单查询（只有空格分隔的词汇）
   */
  private static isSimpleQuery(query: string): boolean {
    // 无特殊符号，只有空格分隔的词汇
    return !/[|()"：:]/gi.test(query) && !/标题|title/i.test(query);
  }

  /**
   * 检测是否可能是部分输入（避免过多的错误日志）
   */
  private static isLikelyPartialInput(query: string): boolean {
    const trimmed = query.trim();

    // 常见的部分输入模式
    const partialPatterns = [
      /标题[:：]?$/, // 只输入了"标题:"
      /title[:：]?$/i, // 只输入了"title:"
      /\(.*[^)]$/, // 未闭合的左括号
      /^[^(]*\)$/, // 未匹配的右括号
      /"[^"]*$/, // 未闭合的引号
      /[""][^""]*$/, // 未闭合的全角引号
      /\|$/, // 以OR操作符结尾
      /\s+$/, // 以空格结尾
    ];

    return partialPatterns.some((pattern) => pattern.test(trimmed));
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
      // 单个词
      return {
        type: "WORD",
        value: words[0],
      };
    } else {
      // 多个词，用 AND 连接
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

      // 🚀 性能优化：简单查询使用快速路径
      if (this.isSimpleQuery(query)) {
        const ast = this.parseSimpleQuery(query);
        return ast;
      }

      // 复杂查询使用完整解析器
      const tokenizer = new SearchTokenizer(query);
      const tokens = tokenizer.tokenize();

      // 过滤掉空白 token（如果有的话）
      const filteredTokens = tokens.filter(
        (token) => token.type !== TokenType.WHITESPACE,
      );

      const parser = new SearchParser(filteredTokens);
      const ast = parser.parse();

      return ast;
    } catch (error) {
      // 🤫 用户输入过程中的语法错误是正常的，静默处理
      if (error instanceof ParseError) {
        // 静默处理解析错误，不在控制台输出
        throw error;
      }

      // 其他类型的错误可能是程序bug，只在开发环境记录
      if (process.env.NODE_ENV === "development") {
        console.error("[AdvancedSearchParser] 解析器内部错误:", error);
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
