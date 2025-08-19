import { ChatMessage } from "../../../store/message";
import { SystemMessageData } from "../../../store/system";

// 搜索结果接口
export interface SearchResult {
  sessionId: string;
  topic: string;
  lastUpdate: number;
  matchedMessages: ChatMessage[];
  matchedSystemMessage?: SystemMessageData;
  matchType: "title" | "message" | "system" | "multiple";
  matchedTerms?: string[]; // 匹配的搜索词
}

// 搜索统计信息
export interface SearchStats {
  totalSessions: number;
  sessionsWithTitleMatch: number;
  sessionsWithMessageMatch: number;
  sessionsWithSystemMatch: number;
  totalMatches: number;
  searchDuration: number;
  queryComplexity: "simple" | "moderate" | "complex";
}

// 搜索配置
export interface SearchOptions {
  caseSensitive?: boolean;
  searchInSystemMessages?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
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

// Token 类型枚举
export enum TokenType {
  WORD = "WORD",
  QUOTED = "QUOTED",
  TITLE_PREFIX = "TITLE_PREFIX",
  OR_OPERATOR = "OR_OPERATOR",
  LEFT_PAREN = "LEFT_PAREN",
  RIGHT_PAREN = "RIGHT_PAREN",
  WHITESPACE = "WHITESPACE",
  EOF = "EOF",
}

// Token 接口
export interface Token {
  type: TokenType;
  value: string;
  position: number;
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

// 高亮类型枚举
export enum HighlightType {
  EXACT = "exact",
  WORD = "word",
  TITLE = "title",
  PARTIAL = "partial",
}

// 高亮片段接口
export interface HighlightSegment {
  text: string;
  isHighlighted: boolean;
  highlightType?: HighlightType;
  originalTerm?: string;
}

// 高亮选项
export interface HighlightOptions {
  caseSensitive?: boolean;
  maxContextLength?: number;
  leftContextChars?: number;
  rightContextChars?: number;
}
