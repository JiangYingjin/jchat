import localforage from "localforage";
import pLimit from "p-limit";
import type { RequestMessage } from "../client/api";
import { isClient } from "../utils";

export type ChatMessage = RequestMessage & {
  id: string;
  model?: string;
  date: string;
  streaming?: boolean;
  isError?: boolean;
};

// 保存请求接口
interface SaveRequest {
  sessionId: string;
  messages: ChatMessage[];
  timestamp: number; // 提交时的时间戳
  force?: boolean; // 是否强制保存（绕过频率限制）
}

// 会话状态接口
interface SessionState {
  lastSaveTimestamp: number; // 最新完成保存的时间戳
  lastRequestTimestamp: number; // 上次请求时间戳（用于频率控制）
}

// 使用 localforage 存储聊天消息
class MessageStorage {
  private storage: LocalForage | null = null;

  // LIFO 队列存储保存请求
  private saveQueue: SaveRequest[] = [];

  // 每个会话的状态管理
  private sessionStates: Map<string, SessionState> = new Map();

  // p-limit 限制并发数为 3
  private saveLimit = pLimit(3);

  private getStorage(): LocalForage | null {
    if (!isClient) {
      return null;
    }
    if (!this.storage) {
      this.storage = localforage.createInstance({
        name: "JChat",
        storeName: "messages",
      });
    }
    return this.storage;
  }

  /**
   * 获取或创建会话状态
   */
  private getSessionState(sessionId: string): SessionState {
    if (!this.sessionStates.has(sessionId)) {
      this.sessionStates.set(sessionId, {
        lastSaveTimestamp: 0,
        lastRequestTimestamp: 0,
      });
    }
    return this.sessionStates.get(sessionId)!;
  }

  /**
   * 检查频率限制（每秒最多一次）
   */
  private checkRateLimit(sessionId: string, currentTimestamp: number): boolean {
    const sessionState = this.getSessionState(sessionId);
    return currentTimestamp - sessionState.lastRequestTimestamp >= 1000;
  }

  /**
   * 处理保存队列（LIFO + p-limit）
   */
  private async processQueue(): Promise<void> {
    while (this.saveQueue.length > 0) {
      // LIFO: 取队首（最新请求）
      const request = this.saveQueue.shift()!;

      // 提交到 p-limit 处理
      this.saveLimit(async () => {
        await this.processSaveRequest(request);
      });
    }
  }

  /**
   * 处理单个保存请求
   */
  private async processSaveRequest(request: SaveRequest): Promise<void> {
    const { sessionId, messages, timestamp, force } = request;
    const sessionState = this.getSessionState(sessionId);

    // 时间戳比较：如果请求时间戳 <= 最新完成时间戳，则跳过
    if (timestamp <= sessionState.lastSaveTimestamp) {
      console.log(
        `[MessageStorage] 跳过过期请求 ${sessionId} (${timestamp} <= ${sessionState.lastSaveTimestamp})`,
      );
      return;
    }

    try {
      const storage = this.getStorage();
      if (!storage) {
        console.warn("[MessageStorage] ⚠️ 存储实例为空 (服务器端?)", {
          sessionId,
        });
        return;
      }

      // 添加超时处理
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("IndexedDB operation timeout")),
          5000,
        );
      });

      const savePromise = storage.setItem(sessionId, messages);
      await Promise.race([savePromise, timeoutPromise]);

      // 保存完成后，更新最新完成时间戳（使用请求的时间戳）
      sessionState.lastSaveTimestamp = timestamp;

      const forceLabel = force ? " [FORCE]" : "";
      console.log(
        `[MessageStorage] ✅ 成功保存到 IndexedDB ${sessionId} (timestamp: ${timestamp})${forceLabel}`,
      );
    } catch (error) {
      console.error(`[MessageStorage] ❌ 保存消息失败: ${sessionId}`, error);
      console.error("[MessageStorage] 错误详情:", {
        sessionId,
        messageCount: messages?.length || 0,
        timestamp,
        force,
        errorMessage: (error as Error)?.message || String(error),
        errorStack: (error as Error)?.stack,
        isClient: typeof window !== "undefined",
      });
      console.error("[MessageStorage] 如果问题持续存在，请重启浏览器重试");
    }
  }

  /**
   * 获取指定会话的消息数组
   * @param sessionId 会话 ID
   * @returns 消息数组，如果不存在则返回空数组
   */
  async get(sessionId: string): Promise<ChatMessage[]> {
    try {
      const storage = this.getStorage();
      if (!storage) return [];
      const messages = await storage.getItem<ChatMessage[]>(sessionId);
      return messages || [];
    } catch (error) {
      console.error(`[MessageStorage] 获取消息失败: ${sessionId}`, error);
      return [];
    }
  }

  /**
   * 保存消息数组到指定会话
   * @param sessionId 会话 ID
   * @param messages 消息数组
   * @param force 是否强制保存（绕过频率限制），用于 stream 完成等重要时刻
   */
  async save(
    sessionId: string,
    messages: ChatMessage[],
    force: boolean = false,
  ): Promise<boolean> {
    const currentTimestamp = Date.now();
    const sessionState = this.getSessionState(sessionId);

    // 频率控制：每秒最多一次（强制保存时跳过检查）
    if (!force && !this.checkRateLimit(sessionId, currentTimestamp)) {
      console.log(
        `[MessageStorage] 频率限制跳过 ${sessionId} (${currentTimestamp - sessionState.lastRequestTimestamp}ms < 1000ms)`,
      );
      return false;
    }

    // 更新上次请求时间戳
    sessionState.lastRequestTimestamp = currentTimestamp;

    // 创建保存请求
    const saveRequest: SaveRequest = {
      sessionId,
      messages,
      timestamp: currentTimestamp,
      force,
    };

    // LIFO：新请求插入队首
    this.saveQueue.unshift(saveRequest);

    const forceLabel = force ? " [强制保存]" : "";
    console.log(
      `[MessageStorage] 💾 加入保存队列 ${sessionId} (timestamp: ${currentTimestamp}, 队列长度: ${this.saveQueue.length})${forceLabel}`,
    );

    // 异步处理队列
    this.processQueue();

    return true;
  }

  /**
   * 检查 IndexedDB 是否正常工作
   */
  async healthCheck(): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false;

      const testKey = "__health_check__";
      const testValue = { timestamp: Date.now() };

      // 超时保护
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Health check timeout")), 3000);
      });

      // 测试写入
      const writePromise = storage.setItem(testKey, testValue);
      await Promise.race([writePromise, timeoutPromise]);

      // 测试读取
      const readPromise = storage.getItem(testKey);
      const result = await Promise.race([readPromise, timeoutPromise]);

      // 清理测试数据
      await storage.removeItem(testKey);

      return result !== null;
    } catch (error) {
      console.error("[MessageStorage] 健康检查失败", error);
      console.error("[MessageStorage] 如果问题持续存在，请重启浏览器重试");
      return false;
    }
  }

  /**
   * 删除指定会话的消息
   * @param sessionId 会话 ID
   */
  async delete(sessionId: string): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      await storage.removeItem(sessionId);

      // 清理会话状态
      this.sessionStates.delete(sessionId);

      return true;
    } catch (error) {
      console.error(`[MessageStorage] 删除消息失败: ${sessionId}`, error);
      return false;
    }
  }

  /**
   * 获取队列统计信息（用于调试）
   */
  getQueueStats() {
    return {
      queueLength: this.saveQueue.length,
      sessionsCount: this.sessionStates.size,
      sessionStates: Object.fromEntries(this.sessionStates),
      queueRequests: this.saveQueue.map((req) => ({
        sessionId: req.sessionId,
        timestamp: req.timestamp,
        force: req.force,
      })),
    };
  }
}

// 创建全局实例
export const messageStorage = new MessageStorage();
