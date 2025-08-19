import { TokenType, Token, SearchAST, ParseError } from "../types";

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
