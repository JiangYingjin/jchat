import { ChatMessage } from "../store/message";
import { SystemMessageData } from "../store/system";

// 搜索结果接口（统一）
export interface SearchResult {
  sessionId: string;
  topic: string;
  lastUpdate: number;
  matchedMessages: ChatMessage[];
  matchedSystemMessage?: SystemMessageData;
  matchType: "title" | "message" | "system" | "multiple";
  matchedTerms?: string[]; // 匹配的搜索词（可选）
}

// 搜索统计信息
export interface SearchStats {
  totalSessions: number;
  sessionsWithTitleMatch: number;
  sessionsWithMessageMatch: number;
  sessionsWithSystemMatch: number;
  totalMatches: number;
  searchDuration: number;
  queryComplexity: "simple" | "moderate" | "complex"; // 查询复杂度
}

// 搜索配置
export interface SearchOptions {
  caseSensitive?: boolean;
  searchInSystemMessages?: boolean;
  maxResults?: number;
  signal?: AbortSignal; // 支持取消搜索
}
