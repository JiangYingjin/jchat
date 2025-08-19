import { useChatStore } from "../../../store/chat";
import { AdvancedSearchParser } from "../parser";
import { AdvancedSearch } from "./search-executor";
import { SearchResult, SearchStats, SearchOptions, ParseError } from "../types";

/**
 * 统一搜索服务类
 * 所有搜索都基于高级搜索语法，支持从简单到复杂的查询
 */
export class SearchService {
  private currentSearchController: AbortController | null = null;

  /**
   * 检测查询复杂度（用于性能优化）
   */
  private getQueryComplexity(query: string): "simple" | "moderate" | "complex" {
    // 复杂查询：含有括号、标题前缀
    if (/\([^)]*\)|（[^）]*）|标题[:：]|title[:：]/i.test(query)) {
      return "complex";
    }

    // 中等查询：含有OR操作符或引号
    if (/\||"[^"]*"|[\u201c][\s\S]*?[\u201d]/.test(query)) {
      return "moderate";
    }

    // 简单查询：只有词汇和空格（AND）
    return "simple";
  }

  /**
   * 执行统一搜索（完全基于高级搜索引擎）
   * @param query 搜索关键词
   * @param options 搜索选项
   * @returns 搜索结果和统计信息
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<{
    results: SearchResult[];
    stats: SearchStats;
  }> {
    const startTime = Date.now();

    // 去掉前后空格，确保搜索query的一致性
    query = query.trim();

    // 🚨 修复：防止空查询和仅包含引号的查询导致内存泄漏
    // 检查是否为危险的空查询模式
    if (
      query === '""' ||
      query === "''" ||
      query === '""""' ||
      query === "''''"
    ) {
      return {
        results: [],
        stats: {
          totalSessions: useChatStore.getState().sessions.length,
          sessionsWithTitleMatch: 0,
          sessionsWithMessageMatch: 0,
          sessionsWithSystemMatch: 0,
          totalMatches: 0,
          searchDuration: Date.now() - startTime,
          queryComplexity: "simple",
        },
      };
    }

    // 取消之前的搜索
    this.cancelCurrentSearch();

    // 创建新的取消控制器
    this.currentSearchController = new AbortController();
    const signal = options.signal || this.currentSearchController.signal;

    try {
      // 获取所有会话
      const sessions = useChatStore.getState().sessions;

      if (query.length === 0) {
        return {
          results: [],
          stats: {
            totalSessions: sessions.length,
            sessionsWithTitleMatch: 0,
            sessionsWithMessageMatch: 0,
            sessionsWithSystemMatch: 0,
            totalMatches: 0,
            searchDuration: Date.now() - startTime,
            queryComplexity: "simple",
          },
        };
      }

      // 检查信号是否已被取消
      if (signal.aborted) {
        const abortError = new Error("Search aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      // 检测查询复杂度
      const queryComplexity = this.getQueryComplexity(query);

      try {
        // 统一使用高级搜索引擎
        const ast = AdvancedSearchParser.parse(query);
        const results = await AdvancedSearch.execute(ast, signal);

        const searchDuration = Date.now() - startTime;

        return {
          results,
          stats: {
            totalSessions: sessions.length,
            sessionsWithTitleMatch: results.filter(
              (r: SearchResult) =>
                r.matchType === "title" || r.matchType === "multiple",
            ).length,
            sessionsWithMessageMatch: results.filter(
              (r: SearchResult) =>
                r.matchType === "message" || r.matchType === "multiple",
            ).length,
            sessionsWithSystemMatch: results.filter(
              (r: SearchResult) =>
                r.matchType === "system" || r.matchType === "multiple",
            ).length,
            totalMatches: results.length,
            searchDuration,
            queryComplexity,
          },
        };
      } catch (error) {
        if (error instanceof ParseError) {
          throw error;
        } else if (signal.aborted) {
          return {
            results: [],
            stats: {
              totalSessions: sessions.length,
              sessionsWithTitleMatch: 0,
              sessionsWithMessageMatch: 0,
              sessionsWithSystemMatch: 0,
              totalMatches: 0,
              searchDuration: Date.now() - startTime,
              queryComplexity,
            },
          };
        } else {
          throw error;
        }
      }
    } catch (error) {
      // 检查是否是取消错误
      if (signal?.aborted) {
        return {
          results: [],
          stats: {
            totalSessions: useChatStore.getState().sessions.length,
            sessionsWithTitleMatch: 0,
            sessionsWithMessageMatch: 0,
            sessionsWithSystemMatch: 0,
            totalMatches: 0,
            searchDuration: Date.now() - startTime,
            queryComplexity: "simple",
          },
        };
      }
      throw error;
    } finally {
      // 清理控制器
      if (this.currentSearchController) {
        this.currentSearchController = null;
      }
    }
  }

  /**
   * 取消当前搜索
   */
  cancelCurrentSearch(): void {
    if (this.currentSearchController) {
      this.currentSearchController.abort();
      this.currentSearchController = null;
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancelCurrentSearch();
  }
}

// 创建全局搜索服务实例
export const searchService = new SearchService();
