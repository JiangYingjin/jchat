import { TokenType, Token, ParseError } from "../types";

/**
 * 词法分析器 - 将输入字符串转换为 Token 流
 */
export class SearchTokenizer {
  private input: string;
  private position: number = 0;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = this.normalizeInput(input);
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
      !/[\s()|":]/.test(this.input[this.position])
    ) {
      value += this.input[this.position];
      this.position++;
    }

    if (value.length === 0) {
      return;
    }

    // 检查当前字符是否为冒号
    if (
      this.position < this.input.length &&
      this.input[this.position] === ":"
    ) {
      // 检查是否为标题前缀
      if (value === "标题" || value.toLowerCase() === "title") {
        this.position++; // 跳过冒号
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
