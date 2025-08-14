import { ChatMessage } from "../store/message";
import { SystemMessageData } from "../store/system";
import { messageStorage } from "../store/message";
import { systemMessageStorage } from "../store/system";
import { useChatStore } from "../store/chat";
import { getMessageTextContent } from "../utils";

// 搜索结果接口
export interface SearchResult {
  sessionId: string;
  topic: string;
  lastUpdate: number;
  matchedMessages: ChatMessage[];
  matchedSystemMessage?: SystemMessageData;
  matchType: "title" | "message" | "system" | "multiple";
}

// 搜索统计信息
export interface SearchStats {
  totalSessions: number;
  sessionsWithTitleMatch: number;
  sessionsWithMessageMatch: number;
  sessionsWithSystemMatch: number;
  totalMatches: number;
  searchDuration: number;
}

// 搜索配置
export interface SearchOptions {
  caseSensitive?: boolean;
  searchInSystemMessages?: boolean;
  maxResults?: number;
  signal?: AbortSignal; // 支持取消搜索
}

/**
 * 综合搜索服务类
 * 实现三阶段累积搜索：标题 -> 消息 -> 系统提示词
 */
export class SearchService {
  private currentSearchController: AbortController | null = null;

  /**
   * 执行综合搜索
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

    // 取消之前的搜索
    this.cancelCurrentSearch();

    // 创建新的取消控制器
    this.currentSearchController = new AbortController();
    const signal = options.signal || this.currentSearchController.signal;

    try {
      const {
        caseSensitive = false,
        searchInSystemMessages = true,
        // 移除 maxResults 限制，显示所有搜索结果
      } = options;

      // 获取所有会话
      const sessions = useChatStore.getState().sessions;
      const validSessionIds = new Set(sessions.map((s) => s.id));

      // 预处理查询字符串
      const processedQuery = caseSensitive ? query : query.toLowerCase();

      if (processedQuery.trim().length === 0) {
        return {
          results: [],
          stats: {
            totalSessions: sessions.length,
            sessionsWithTitleMatch: 0,
            sessionsWithMessageMatch: 0,
            sessionsWithSystemMatch: 0,
            totalMatches: 0,
            searchDuration: Date.now() - startTime,
          },
        };
      }

      // 检查是否被取消
      this.checkAbortion(signal);

      const results = new Map<string, SearchResult>();
      let titleMatches = 0;
      let messageMatches = 0;
      let systemMatches = 0;

      // 第一阶段：搜索会话标题
      console.log("[SearchService] 开始第一阶段：搜索会话标题");
      for (const session of sessions) {
        this.checkAbortion(signal);

        const titleContent = caseSensitive
          ? session.title
          : session.title.toLowerCase();
        if (titleContent.includes(processedQuery)) {
          titleMatches++;
          results.set(session.id, {
            sessionId: session.id,
            topic: session.title,
            lastUpdate: session.lastUpdate,
            matchedMessages: [],
            matchType: "title",
          });
        }
      }
      console.log(`[SearchService] 第一阶段完成，标题匹配: ${titleMatches}`);

      // 第二阶段：搜索消息存储桶
      console.log("[SearchService] 开始第二阶段：搜索消息存储桶");
      await this.searchMessagesStorage(
        sessions,
        validSessionIds,
        processedQuery,
        caseSensitive,
        results,
        signal,
      );

      // 统计消息匹配数
      for (const result of results.values()) {
        if (result.matchedMessages.length > 0) {
          messageMatches++;
        }
      }
      console.log(
        `[SearchService] 第二阶段完成，消息匹配会话: ${messageMatches}`,
      );

      // 第三阶段：搜索系统消息存储桶
      if (searchInSystemMessages) {
        console.log("[SearchService] 开始第三阶段：搜索系统消息存储桶");
        await this.searchSystemMessagesStorage(
          sessions,
          processedQuery,
          caseSensitive,
          results,
          signal,
        );

        // 统计系统消息匹配数
        for (const result of results.values()) {
          if (result.matchedSystemMessage) {
            systemMatches++;
          }
        }
        console.log(
          `[SearchService] 第三阶段完成，系统消息匹配会话: ${systemMatches}`,
        );
      }

      // 更新匹配类型
      this.updateMatchTypes(results);

      // 按最后更新时间排序（时间倒序），不限制结果数量
      const sortedResults = Array.from(results.values()).sort(
        (a, b) => b.lastUpdate - a.lastUpdate,
      );

      const searchDuration = Date.now() - startTime;
      console.log(
        `[SearchService] 搜索完成，耗时: ${searchDuration}ms，结果: ${sortedResults.length}`,
      );

      return {
        results: sortedResults,
        stats: {
          totalSessions: sessions.length,
          sessionsWithTitleMatch: titleMatches,
          sessionsWithMessageMatch: messageMatches,
          sessionsWithSystemMatch: systemMatches,
          totalMatches: sortedResults.length,
          searchDuration,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("[SearchService] 搜索被取消");
        throw error;
      }
      console.error("[SearchService] 搜索失败:", error);
      throw error;
    } finally {
      // 清理控制器
      if (this.currentSearchController) {
        this.currentSearchController = null;
      }
    }
  }

  /**
   * 搜索消息存储桶
   */
  private async searchMessagesStorage(
    sessions: any[],
    validSessionIds: Set<string>,
    query: string,
    caseSensitive: boolean,
    results: Map<string, SearchResult>,
    signal: AbortSignal,
  ): Promise<void> {
    // 并发加载所有会话的消息，但限制并发数避免过载
    const BATCH_SIZE = 5; // 每批处理5个会话

    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      this.checkAbortion(signal);

      const batch = sessions.slice(i, i + BATCH_SIZE);
      const messagePromises = batch.map(async (session) => {
        try {
          // 添加超时保护
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("Message loading timeout")),
              5000,
            );
          });

          const messagesPromise = messageStorage.get(session.id);
          const messages = await Promise.race([
            messagesPromise,
            timeoutPromise,
          ]);

          return { sessionId: session.id, messages, session };
        } catch (error) {
          console.warn(
            `[SearchService] 加载会话 ${session.id} 消息失败:`,
            error,
          );
          return { sessionId: session.id, messages: [], session };
        }
      });

      const batchResults = await Promise.allSettled(messagePromises);

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          const { sessionId, messages, session } = result.value;

          try {
            // 过滤有效消息并进行搜索匹配
            const validMessages = messages.filter((msg) => {
              // 更严格的数据验证
              return (
                msg &&
                typeof msg === "object" &&
                msg.id &&
                msg.content !== undefined &&
                validSessionIds.has(sessionId)
              );
            });

            const matchedMessages = validMessages.filter((msg) => {
              try {
                const content = getMessageTextContent(msg);
                if (!content || typeof content !== "string") return false;

                const processedContent = caseSensitive
                  ? content
                  : content.toLowerCase();
                return processedContent.includes(query);
              } catch (error) {
                console.warn(`[SearchService] 处理消息内容失败:`, error, msg);
                return false;
              }
            });

            if (matchedMessages.length > 0) {
              const existing = results.get(sessionId);
              if (existing) {
                existing.matchedMessages = matchedMessages;
              } else {
                results.set(sessionId, {
                  sessionId,
                  topic: session.title,
                  lastUpdate: session.lastUpdate,
                  matchedMessages,
                  matchType: "message",
                });
              }
            }
          } catch (error) {
            console.warn(
              `[SearchService] 处理会话 ${sessionId} 消息匹配失败:`,
              error,
            );
          }
        }
      }
    }
  }

  /**
   * 搜索系统消息存储桶
   */
  private async searchSystemMessagesStorage(
    sessions: any[],
    query: string,
    caseSensitive: boolean,
    results: Map<string, SearchResult>,
    signal: AbortSignal,
  ): Promise<void> {
    // 并发加载系统消息
    const BATCH_SIZE = 10; // 系统消息较小，可以更大的批次

    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      this.checkAbortion(signal);

      const batch = sessions.slice(i, i + BATCH_SIZE);
      const systemPromises = batch.map(async (session) => {
        try {
          // 添加超时保护
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("System message loading timeout")),
              3000,
            );
          });

          const systemPromise = systemMessageStorage.get(session.id);
          const systemMessage = await Promise.race([
            systemPromise,
            timeoutPromise,
          ]);

          return { sessionId: session.id, systemMessage, session };
        } catch (error) {
          console.warn(
            `[SearchService] 加载会话 ${session.id} 系统消息失败:`,
            error,
          );
          return { sessionId: session.id, systemMessage: null, session };
        }
      });

      const batchResults = await Promise.allSettled(systemPromises);

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          const { sessionId, systemMessage, session } = result.value;

          try {
            if (
              systemMessage &&
              systemMessage.text &&
              typeof systemMessage.text === "string" &&
              systemMessage.text.trim().length > 0
            ) {
              const content = caseSensitive
                ? systemMessage.text
                : systemMessage.text.toLowerCase();
              if (content.includes(query)) {
                const existing = results.get(sessionId);
                if (existing) {
                  existing.matchedSystemMessage = systemMessage;
                } else {
                  results.set(sessionId, {
                    sessionId,
                    topic: session.title,
                    lastUpdate: session.lastUpdate,
                    matchedMessages: [],
                    matchedSystemMessage: systemMessage,
                    matchType: "system",
                  });
                }
              }
            }
          } catch (error) {
            console.warn(
              `[SearchService] 处理会话 ${sessionId} 系统消息匹配失败:`,
              error,
            );
          }
        }
      }
    }
  }

  /**
   * 更新匹配类型
   */
  private updateMatchTypes(results: Map<string, SearchResult>): void {
    for (const result of results.values()) {
      const hasTitle = result.matchType === "title";
      const hasMessages = result.matchedMessages.length > 0;
      const hasSystem = !!result.matchedSystemMessage;

      const matchCount = [hasTitle, hasMessages, hasSystem].filter(
        Boolean,
      ).length;

      if (matchCount > 1) {
        result.matchType = "multiple";
      } else if (hasMessages) {
        result.matchType = "message";
      } else if (hasSystem) {
        result.matchType = "system";
      }
      // title 类型保持不变
    }
  }

  /**
   * 检查搜索是否被取消
   */
  private checkAbortion(signal: AbortSignal): void {
    if (signal.aborted) {
      const error = new Error("Search aborted");
      error.name = "AbortError";
      throw error;
    }
  }

  /**
   * 清理无效的会话数据
   * 删除已不存在会话的消息和系统消息
   */
  async cleanupInvalidData(): Promise<{
    cleanedMessages: number;
    cleanedSystemMessages: number;
  }> {
    try {
      const sessions = useChatStore.getState().sessions;
      const validSessionIds = new Set(sessions.map((s) => s.id));

      let cleanedMessages = 0;
      let cleanedSystemMessages = 0;

      // 注意：这里只是示例，实际清理可能需要在存储层面实现
      // 因为 localforage 没有直接的 keys() 方法来获取所有键
      console.log(`[SearchService] 当前有效会话: ${validSessionIds.size} 个`);

      return { cleanedMessages, cleanedSystemMessages };
    } catch (error) {
      console.error("[SearchService] 清理无效数据失败:", error);
      return { cleanedMessages: 0, cleanedSystemMessages: 0 };
    }
  }

  /**
   * 获取搜索性能统计
   */
  getPerformanceStats(): {
    averageSearchTime: number;
    totalSearches: number;
    errorRate: number;
  } {
    // 这里可以添加性能统计逻辑
    return {
      averageSearchTime: 0,
      totalSearches: 0,
      errorRate: 0,
    };
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
