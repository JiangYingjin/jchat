import { SearchAST, SearchResult } from "../types";
import { ChatMessage } from "../../../store/message";
import { SystemMessageData } from "../../../store/system";
import { messageStorage } from "../../../store/message";
import { systemMessageStorage } from "../../../store/system";
import { useChatStore } from "../../../store/chat";
import { getMessageTextContent } from "../../../utils";

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
        const abortError = new Error("Search aborted");
        abortError.name = "AbortError";
        throw abortError;
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
    const allMatchedTerms = new Set<string>(result.matchedTerms);

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

      // 合并匹配词（去重）
      childResult.matchedTerms.forEach((term) => allMatchedTerms.add(term));

      result = {
        matched: intersection.size > 0,
        sessions: intersection,
        matchedTerms: Array.from(allMatchedTerms),
      };
    }

    return result;
  }

  /**
   * 执行 OR 操作
   */
  private async executeOr(children: SearchAST[]): Promise<MatchResult> {
    const allSessions = new Set<string>();
    const allMatchedTerms = new Set<string>();
    let hasMatch = false;

    for (const child of children) {
      const childResult = await this.executeNode(child);
      if (childResult.matched) {
        hasMatch = true;
        childResult.sessions.forEach((sessionId) => allSessions.add(sessionId));
        childResult.matchedTerms.forEach((term) => allMatchedTerms.add(term));
      }
    }

    return {
      matched: hasMatch,
      sessions: allSessions,
      matchedTerms: Array.from(allMatchedTerms),
    };
  }

  /**
   * 执行标题搜索 - 只在标题中搜索
   */
  private async executeTitle(node: SearchAST): Promise<MatchResult> {
    const titleMatches = new Set<string>();
    const allMatchedTerms = new Set<string>();

    // 在标题中搜索，需要直接处理不同类型的节点
    for (const session of this.context.sessions) {
      const titleText = session.title.toLowerCase();
      let sessionMatches = false;
      const sessionMatchedTerms: string[] = [];

      if (node.type === "WORD") {
        const word = node.value!.toLowerCase();
        if (titleText.includes(word)) {
          sessionMatches = true;
          sessionMatchedTerms.push(node.value!);
        }
      } else if (node.type === "EXACT") {
        const phrase = node.value!.toLowerCase();
        if (titleText.includes(phrase)) {
          sessionMatches = true;
          sessionMatchedTerms.push(node.value!);
        }
      } else if (node.type === "AND") {
        const andTerms: string[] = [];
        let allWordsMatch = true;

        for (const child of node.children!) {
          if (child.type === "WORD") {
            const word = child.value!.toLowerCase();
            if (titleText.includes(word)) {
              andTerms.push(child.value!);
            } else {
              allWordsMatch = false;
              break;
            }
          } else if (child.type === "EXACT") {
            const phrase = child.value!.toLowerCase();
            if (titleText.includes(phrase)) {
              andTerms.push(child.value!);
            } else {
              allWordsMatch = false;
              break;
            }
          }
        }

        if (allWordsMatch && andTerms.length > 0) {
          sessionMatches = true;
          sessionMatchedTerms.push(...andTerms);
        }
      } else if (node.type === "OR") {
        for (const child of node.children!) {
          if (child.type === "WORD") {
            const word = child.value!.toLowerCase();
            if (titleText.includes(word)) {
              sessionMatches = true;
              sessionMatchedTerms.push(child.value!);
            }
          } else if (child.type === "EXACT") {
            const phrase = child.value!.toLowerCase();
            if (titleText.includes(phrase)) {
              sessionMatches = true;
              sessionMatchedTerms.push(child.value!);
            }
          }
        }
      }

      if (sessionMatches) {
        titleMatches.add(session.id);
        sessionMatchedTerms.forEach((term) => allMatchedTerms.add(term));
      }
    }

    return {
      matched: titleMatches.size > 0,
      sessions: titleMatches,
      matchedTerms: Array.from(allMatchedTerms),
    };
  }

  /**
   * 执行精确匹配搜索
   */
  private async executeExact(phrase: string): Promise<MatchResult> {
    // 🚨 修复：防止空字符串导致的内存泄漏
    if (!phrase || phrase.trim().length === 0) {
      return { matched: false, sessions: new Set(), matchedTerms: [] };
    }

    const matches = new Set<string>();
    const lowerPhrase = phrase.toLowerCase();

    for (const session of this.context.sessions) {
      let sessionMatches = false;

      // 检查信号是否被取消
      if (this.context.signal?.aborted) {
        const abortError = new Error("Search aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

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
          // 静默处理加载失败
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
          // 静默处理加载失败
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
    // 🚨 修复：防止空字符串导致的内存泄漏
    if (!word || word.trim().length === 0) {
      return { matched: false, sessions: new Set(), matchedTerms: [] };
    }

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
          // 静默处理加载失败
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
          // 静默处理加载失败
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
      const actualMatchedTerms = new Set<string>();

      const result: SearchResult = {
        sessionId: session.id,
        topic: session.title,
        lastUpdate: session.lastUpdate,
        matchedMessages: [],
        matchType: "message",
        matchedTerms: [],
      };

      let hasMatches = false;

      // 检查标题匹配
      const titleMatchedTerms = this.findMatchedTermsInText(
        session.title,
        searchTerms,
      );
      const titleMatches = titleMatchedTerms.length > 0;

      if (titleMatches) {
        titleMatchedTerms.forEach((term) => actualMatchedTerms.add(term));
      }

      // 收集匹配的消息
      try {
        const messages = await messageStorage.get(session.id);
        const matchedMessages = messages.filter((message) => {
          const content = getMessageTextContent(message);
          const messageMatchedTerms = this.findMatchedTermsInText(
            content,
            searchTerms,
          );

          if (messageMatchedTerms.length > 0) {
            messageMatchedTerms.forEach((term) => actualMatchedTerms.add(term));
            return true;
          }
          return false;
        });

        if (matchedMessages.length > 0) {
          result.matchedMessages = matchedMessages;
          hasMatches = true;
        }
      } catch (error) {
        // 静默处理加载失败
      }

      // 检查系统消息匹配
      try {
        const systemMessage = await systemMessageStorage.get(session.id);
        if (systemMessage.text) {
          const systemMatchedTerms = this.findMatchedTermsInText(
            systemMessage.text,
            searchTerms,
          );

          if (systemMatchedTerms.length > 0) {
            systemMatchedTerms.forEach((term) => actualMatchedTerms.add(term));
            result.matchedSystemMessage = systemMessage;
            hasMatches = true;
          }
        }
      } catch (error) {
        // 静默处理加载失败
      }

      // 设置实际匹配的词汇列表
      result.matchedTerms = Array.from(actualMatchedTerms);

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
      return null;
    }
  }

  /**
   * 在文本中查找实际匹配的词汇
   */
  private findMatchedTermsInText(
    text: string,
    candidateTerms: string[],
  ): string[] {
    const matchedTerms: string[] = [];
    const lowerText = text.toLowerCase();

    for (const term of candidateTerms) {
      // 🚨 修复：忽略空字符串和空白词汇，防止误匹配
      if (!term || term.trim().length === 0) {
        continue;
      }

      const lowerTerm = term.toLowerCase();
      if (lowerText.includes(lowerTerm)) {
        matchedTerms.push(term);
      }
    }

    return matchedTerms;
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
