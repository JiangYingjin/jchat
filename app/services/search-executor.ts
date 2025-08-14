/**
 * 搜索执行引擎
 * 将 AST 语法树转换为实际的搜索操作
 */

import { SearchAST } from "./advanced-search";
import { SearchResult } from "./search-types";
import { ChatMessage } from "../store/message";
import { SystemMessageData } from "../store/system";
import { messageStorage } from "../store/message";
import { systemMessageStorage } from "../store/system";
import { useChatStore } from "../store/chat";
import { getMessageTextContent } from "../utils";

// 重新导出类型，保持向后兼容
export type { SearchResult };

// 搜索上下文
interface SearchContext {
  sessions: any[];
  validSessionIds: Set<string>;
  signal?: AbortSignal;
}

// 匹配结果
interface MatchResult {
  matched: boolean;
  sessions: Set<string>;
  matchedTerms: string[];
}

/**
 * 搜索执行引擎
 */
export class SearchExecutor {
  private context: SearchContext;

  constructor(context: SearchContext) {
    this.context = context;
  }

  /**
   * 执行搜索 AST
   */
  async execute(ast: SearchAST): Promise<SearchResult[]> {
    const matchResult = await this.executeNode(ast);

    if (!matchResult.matched || matchResult.sessions.size === 0) {
      return [];
    }

    // 构建详细的搜索结果
    const results: SearchResult[] = [];

    for (const sessionId of matchResult.sessions) {
      const session = this.context.sessions.find((s) => s.id === sessionId);
      if (!session) continue;

      // 检查信号是否被取消
      if (this.context.signal?.aborted) {
        // 静默返回空结果，不输出日志
        return [];
      }

      const result = await this.buildSearchResult(
        session,
        matchResult.matchedTerms,
      );
      if (result) {
        results.push(result);
      }
    }

    // 按时间倒序排列
    return results.sort((a, b) => b.lastUpdate - a.lastUpdate);
  }

  /**
   * 执行 AST 节点
   */
  private async executeNode(node: SearchAST): Promise<MatchResult> {
    switch (node.type) {
      case "AND":
        return this.executeAnd(node.children!);
      case "OR":
        return this.executeOr(node.children!);
      case "TITLE":
        return this.executeTitle(node.children![0]);
      case "EXACT":
        return this.executeExact(node.value!);
      case "WORD":
        return this.executeWord(node.value!);
      default:
        throw new Error(`未知的 AST 节点类型: ${node.type}`);
    }
  }

  /**
   * 执行 AND 操作
   */
  private async executeAnd(children: SearchAST[]): Promise<MatchResult> {
    if (children.length === 0) {
      return { matched: false, sessions: new Set(), matchedTerms: [] };
    }

    let result = await this.executeNode(children[0]);
    const allMatchedTerms = [...result.matchedTerms];

    for (let i = 1; i < children.length; i++) {
      if (!result.matched) break;

      const childResult = await this.executeNode(children[i]);
      if (!childResult.matched) {
        return { matched: false, sessions: new Set(), matchedTerms: [] };
      }

      // 取交集
      const intersection = new Set<string>();
      for (const sessionId of result.sessions) {
        if (childResult.sessions.has(sessionId)) {
          intersection.add(sessionId);
        }
      }

      result = {
        matched: intersection.size > 0,
        sessions: intersection,
        matchedTerms: allMatchedTerms.concat(childResult.matchedTerms),
      };
    }

    return result;
  }

  /**
   * 执行 OR 操作
   */
  private async executeOr(children: SearchAST[]): Promise<MatchResult> {
    const allSessions = new Set<string>();
    const allMatchedTerms: string[] = [];
    let hasMatch = false;

    for (const child of children) {
      const childResult = await this.executeNode(child);
      if (childResult.matched) {
        hasMatch = true;
        childResult.sessions.forEach((sessionId) => allSessions.add(sessionId));
        allMatchedTerms.push(...childResult.matchedTerms);
      }
    }

    return {
      matched: hasMatch,
      sessions: allSessions,
      matchedTerms: allMatchedTerms,
    };
  }

  /**
   * 执行标题搜索 - 只在标题中搜索
   */
  private async executeTitle(node: SearchAST): Promise<MatchResult> {
    const titleMatches = new Set<string>();
    let matchedTerms: string[] = [];

    // 直接在标题中搜索，不在其他内容中搜索
    for (const session of this.context.sessions) {
      const titleText = session.title.toLowerCase();
      let sessionMatches = false;

      if (node.type === "WORD") {
        // 单个词搜索
        const word = node.value!.toLowerCase();
        if (titleText.includes(word)) {
          sessionMatches = true;
          matchedTerms.push(node.value!);
        }
      } else if (node.type === "AND") {
        // AND 搜索 - 标题必须包含所有词
        const allWordsMatch = node.children!.every((child) => {
          if (child.type === "WORD") {
            const word = child.value!.toLowerCase();
            return titleText.includes(word);
          }
          return false;
        });

        if (allWordsMatch) {
          sessionMatches = true;
          matchedTerms = node
            .children!.filter((child) => child.type === "WORD")
            .map((child) => child.value!);
        }
      } else if (node.type === "OR") {
        // OR 搜索 - 标题包含任一词即可
        for (const child of node.children!) {
          if (child.type === "WORD") {
            const word = child.value!.toLowerCase();
            if (titleText.includes(word)) {
              sessionMatches = true;
              matchedTerms.push(child.value!);
              break;
            }
          }
        }
      } else if (node.type === "EXACT") {
        // 精确搜索
        const phrase = node.value!.toLowerCase();
        if (titleText.includes(phrase)) {
          sessionMatches = true;
          matchedTerms.push(node.value!);
        }
      }

      if (sessionMatches) {
        titleMatches.add(session.id);
      }
    }

    return {
      matched: titleMatches.size > 0,
      sessions: titleMatches,
      matchedTerms: [...new Set(matchedTerms)], // 去重
    };
  }

  /**
   * 执行精确匹配搜索
   */
  private async executeExact(phrase: string): Promise<MatchResult> {
    const matches = new Set<string>();
    const lowerPhrase = phrase.toLowerCase();

    for (const session of this.context.sessions) {
      let sessionMatches = false;

      // 检查标题
      if (session.title.toLowerCase().includes(lowerPhrase)) {
        sessionMatches = true;
      }

      // 检查消息内容
      if (!sessionMatches) {
        try {
          const messages = await messageStorage.get(session.id);
          for (const message of messages) {
            const content = getMessageTextContent(message).toLowerCase();
            if (content.includes(lowerPhrase)) {
              sessionMatches = true;
              break;
            }
          }
        } catch (error) {
          // 静默处理加载失败，避免控制台警告
        }
      }

      // 检查系统消息
      if (!sessionMatches) {
        try {
          const systemMessage = await systemMessageStorage.get(session.id);
          if (systemMessage.text.toLowerCase().includes(lowerPhrase)) {
            sessionMatches = true;
          }
        } catch (error) {
          // 静默处理加载失败，避免控制台警告
        }
      }

      if (sessionMatches) {
        matches.add(session.id);
      }
    }

    return {
      matched: matches.size > 0,
      sessions: matches,
      matchedTerms: [phrase],
    };
  }

  /**
   * 执行单词搜索
   */
  private async executeWord(word: string): Promise<MatchResult> {
    const matches = new Set<string>();
    const lowerWord = word.toLowerCase();

    for (const session of this.context.sessions) {
      let sessionMatches = false;

      // 检查标题
      if (session.title.toLowerCase().includes(lowerWord)) {
        sessionMatches = true;
      }

      // 检查消息内容
      if (!sessionMatches) {
        try {
          const messages = await messageStorage.get(session.id);
          for (const message of messages) {
            const content = getMessageTextContent(message).toLowerCase();
            if (content.includes(lowerWord)) {
              sessionMatches = true;
              break;
            }
          }
        } catch (error) {
          // 静默处理加载失败，避免控制台警告
        }
      }

      // 检查系统消息
      if (!sessionMatches) {
        try {
          const systemMessage = await systemMessageStorage.get(session.id);
          if (systemMessage.text.toLowerCase().includes(lowerWord)) {
            sessionMatches = true;
          }
        } catch (error) {
          // 静默处理加载失败，避免控制台警告
        }
      }

      if (sessionMatches) {
        matches.add(session.id);
      }
    }

    return {
      matched: matches.size > 0,
      sessions: matches,
      matchedTerms: [word],
    };
  }

  /**
   * 构建详细的搜索结果
   */
  private async buildSearchResult(
    session: any,
    searchTerms: string[],
  ): Promise<SearchResult | null> {
    try {
      const result: SearchResult = {
        sessionId: session.id,
        topic: session.title,
        lastUpdate: session.lastUpdate,
        matchedMessages: [],
        matchType: "message",
        matchedTerms: searchTerms,
      };

      let hasMatches = false;

      // 检查标题匹配
      const titleMatches = searchTerms.some((term) =>
        session.title.toLowerCase().includes(term.toLowerCase()),
      );

      // 收集匹配的消息
      try {
        const messages = await messageStorage.get(session.id);
        const matchedMessages = messages.filter((message) => {
          const content = getMessageTextContent(message).toLowerCase();
          return searchTerms.some((term) =>
            content.includes(term.toLowerCase()),
          );
        });

        if (matchedMessages.length > 0) {
          result.matchedMessages = matchedMessages;
          hasMatches = true;
        }
      } catch (error) {
        console.warn(`加载会话 ${session.id} 消息失败:`, error);
      }

      // 检查系统消息匹配
      try {
        const systemMessage = await systemMessageStorage.get(session.id);
        if (systemMessage.text) {
          const systemMatches = searchTerms.some((term) =>
            systemMessage.text.toLowerCase().includes(term.toLowerCase()),
          );

          if (systemMatches) {
            result.matchedSystemMessage = systemMessage;
            hasMatches = true;
          }
        }
      } catch (error) {
        console.warn(`加载会话 ${session.id} 系统消息失败:`, error);
      }

      // 确定匹配类型
      if (
        titleMatches &&
        result.matchedMessages.length > 0 &&
        result.matchedSystemMessage
      ) {
        result.matchType = "multiple";
      } else if (titleMatches) {
        result.matchType = "title";
      } else if (result.matchedSystemMessage) {
        result.matchType = "system";
      } else if (result.matchedMessages.length > 0) {
        result.matchType = "message";
      }

      return hasMatches || titleMatches ? result : null;
    } catch (error) {
      // 静默处理构建搜索结果失败，避免控制台错误
      return null;
    }
  }
}

/**
 * 高级搜索主入口
 */
export class AdvancedSearch {
  /**
   * 执行高级搜索
   */
  static async execute(
    ast: SearchAST,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const sessions = useChatStore.getState().sessions;
    const validSessionIds = new Set(sessions.map((s) => s.id));

    const context: SearchContext = {
      sessions,
      validSessionIds,
      signal,
    };

    const executor = new SearchExecutor(context);
    return executor.execute(ast);
  }
}
