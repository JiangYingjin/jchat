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
  // 模型回复指标（仅用于 role = "assistant" 的消息）
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  ttft?: number; // time to first token (seconds)
  total_time?: number; // total streaming time (seconds)
  tps?: number; // tokens per second
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

  // 改为串行处理，避免 IndexedDB 并发写入问题
  private saveLimit = pLimit(1);

  // 防止并发处理队列的标志
  private isProcessingQueue = false;

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
   * 检查频率限制（每2秒最多一次）
   */
  private checkRateLimit(sessionId: string, currentTimestamp: number): boolean {
    const sessionState = this.getSessionState(sessionId);
    return currentTimestamp - sessionState.lastRequestTimestamp >= 2000; // 改为 2 秒
  }

  /**
   * 处理保存队列（LIFO + 串行处理）- 防止并发调用
   */
  private async processQueue(): Promise<void> {
    // 防止并发处理队列
    if (this.isProcessingQueue) {
      // console.log("[MessageStorage] 🔄 队列正在处理中，跳过此次调用");
      return;
    }

    this.isProcessingQueue = true;
    // console.log(
    //   `[MessageStorage] 🚀 开始串行处理队列，当前队列长度: ${this.saveQueue.length}`,
    // );

    try {
      // 串行处理队列中的请求，避免 IndexedDB 并发问题
      const requestsToProcess = [...this.saveQueue];
      this.saveQueue = []; // 清空队列

      // console.log(
      //   `[MessageStorage] 📝 串行处理 ${requestsToProcess.length} 个请求`,
      // );

      // 串行处理每个请求
      for (const request of requestsToProcess) {
        try {
          // console.log(
          //   `[MessageStorage] 🔧 开始处理请求 ${request.sessionId} (timestamp: ${request.timestamp}, force: ${request.force})`,
          // );

          // 使用 p-limit(1) 确保串行
          await this.saveLimit(async () => {
            await this.processSaveRequest(request);
          });

          // console.log(
          //   `[MessageStorage] ✅ 完成处理请求 ${request.sessionId} (timestamp: ${request.timestamp})`,
          // );

          // 在每个请求之间添加小延迟，进一步减少 IndexedDB 压力
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch (error) {
          console.error(
            `[MessageStorage] ❌ 处理请求失败 ${request.sessionId}:`,
            error,
          );
        }
      }

      // console.log(
      //   `[MessageStorage] 🎉 串行队列处理完成，处理了 ${requestsToProcess.length} 个请求`,
      // );
    } catch (error) {
      console.error("[MessageStorage] ❌ 队列处理出错:", error);
    } finally {
      this.isProcessingQueue = false;

      // 如果处理期间又有新请求入队，递归处理
      if (this.saveQueue.length > 0) {
        // console.log(
        //   `[MessageStorage] 🔄 处理期间有新请求入队 (${this.saveQueue.length} 个)，继续处理`,
        // );
        // 使用 setTimeout 避免深度递归，并给 IndexedDB 一些恢复时间
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  /**
   * 处理单个保存请求
   */
  private async processSaveRequest(request: SaveRequest): Promise<void> {
    const { sessionId, messages, timestamp, force } = request;
    const sessionState = this.getSessionState(sessionId);

    // 时间戳比较：如果请求时间戳 <= 最新完成时间戳，则跳过
    // 但强制保存的请求不跳过
    if (!force && timestamp <= sessionState.lastSaveTimestamp) {
      // console.log(
      //   `[MessageStorage] ⏭️ 跳过过期请求 ${sessionId} (${timestamp} <= ${sessionState.lastSaveTimestamp})`,
      // );
      return;
    }

    const startTime = Date.now();
    // console.log(
    //   `[MessageStorage] 💾 开始保存 ${sessionId} (timestamp: ${timestamp}, force: ${force}, messageCount: ${messages?.length || 0})`,
    // );

    try {
      const storage = this.getStorage();
      if (!storage) {
        console.warn("[MessageStorage] ⚠️ 存储实例为空 (服务器端?)", {
          sessionId,
        });
        return;
      }

      // 串行处理，可以适当减少超时时间到 8 秒
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `IndexedDB operation timeout after 8s for session ${sessionId}`,
              ),
            ),
          8000,
        );
      });

      const savePromise = storage.setItem(sessionId, messages);
      await Promise.race([savePromise, timeoutPromise]);

      // 保存完成后，更新最新完成时间戳（使用请求的时间戳）
      sessionState.lastSaveTimestamp = timestamp;

      const duration = Date.now() - startTime;
      const forceLabel = force ? " [FORCE]" : "";
      // console.log(
      //   `[MessageStorage] ✅ 成功保存到 IndexedDB ${sessionId} (timestamp: ${timestamp}, 用时: ${duration}ms)${forceLabel}`,
      // );
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[MessageStorage] ❌ 保存消息失败: ${sessionId} (用时: ${duration}ms)`,
        error,
      );
      console.error("[MessageStorage] 错误详情:", {
        sessionId,
        messageCount: messages?.length || 0,
        timestamp,
        force,
        duration,
        errorMessage: (error as Error)?.message || String(error),
        errorStack: (error as Error)?.stack,
        isClient: typeof window !== "undefined",
        currentQueueLength: this.saveQueue.length,
        activeSaveLimit: this.saveLimit.activeCount,
        pendingSaveLimit: this.saveLimit.pendingCount,
      });
      console.error("[MessageStorage] 如果问题持续存在，请重启浏览器重试");
    }
  }

  /**
   * 获取指定会话的消息数组（增强版）
   * @param sessionId 会话 ID
   * @returns 消息数组，如果不存在则返回空数组
   */
  async get(sessionId: string): Promise<ChatMessage[]> {
    if (!sessionId) {
      console.warn("[MessageStorage] sessionId 为空，返回空数组");
      return [];
    }

    try {
      const storage = this.getStorage();
      if (!storage) {
        console.warn("[MessageStorage] 存储不可用，返回空数组");
        return [];
      }

      const messages = await storage.getItem<ChatMessage[]>(sessionId);

      // 更严格的数据验证
      if (!messages) {
        return [];
      }

      if (!Array.isArray(messages)) {
        console.warn(
          `[MessageStorage] 会话 ${sessionId} 的数据格式不正确，不是数组:`,
          typeof messages,
        );
        return [];
      }

      // 验证消息数组中的每个消息对象
      const validMessages = messages.filter((msg, index) => {
        if (!msg || typeof msg !== "object") {
          console.warn(
            `[MessageStorage] 会话 ${sessionId} 第 ${index} 条消息格式不正确:`,
            msg,
          );
          return false;
        }

        // 检查必需字段
        if (!msg.id || !msg.role || (!msg.content && msg.content !== "")) {
          console.warn(
            `[MessageStorage] 会话 ${sessionId} 第 ${index} 条消息缺少必需字段:`,
            msg,
          );
          return false;
        }

        return true;
      });

      if (validMessages.length !== messages.length) {
        console.warn(
          `[MessageStorage] 会话 ${sessionId} 过滤了 ${messages.length - validMessages.length} 条无效消息`,
        );
      }

      return validMessages;
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
    // 数据未恢复时，禁止消息持久化
    // 通过导入的 isDataRestored 状态检查
    if (
      typeof window !== "undefined" &&
      (window as any).__jchat_data_restored !== true
    ) {
      console.log(`[MessageStorage] ❌ 数据未恢复，禁止消息持久化`, {
        sessionId,
        isDataRestored: (window as any).__jchat_data_restored,
        force,
        timestamp: Date.now(),
      });
      return false;
    }

    const currentTimestamp = Date.now();
    const sessionState = this.getSessionState(sessionId);

    // 频率控制：每2秒最多一次（强制保存时跳过检查）
    if (!force && !this.checkRateLimit(sessionId, currentTimestamp)) {
      // console.log(
      //   `[MessageStorage] ⏰ 频率限制跳过 ${sessionId} (${currentTimestamp - sessionState.lastRequestTimestamp}ms < 2000ms)`,
      // );
      return false;
    }

    // 更新上次请求时间戳（只有非强制保存才更新）
    if (!force) {
      sessionState.lastRequestTimestamp = currentTimestamp;
    }

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
    // console.log(
    //   `[MessageStorage] 💾 加入保存队列 ${sessionId} (timestamp: ${currentTimestamp}, 队列长度: ${this.saveQueue.length})${forceLabel}`,
    // );

    // 异步处理队列
    this.processQueue();

    return true;
  }

  /** 等待一条关键消息快照真正写入 IndexedDB，供跨设备导入等事务性流程使用。 */
  async saveAndWait(
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<boolean> {
    if (
      typeof window !== "undefined" &&
      (window as any).__jchat_data_restored !== true
    ) {
      return false;
    }
    const storage = this.getStorage();
    if (!storage) return false;
    try {
      await this.saveLimit(async () => {
        await storage.setItem(sessionId, messages);
      });
      this.getSessionState(sessionId).lastSaveTimestamp = Date.now();
      return true;
    } catch (error) {
      console.error(
        `[MessageStorage] 关键会话快照写入失败: ${sessionId}`,
        error,
      );
      return false;
    }
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

      // 缩短超时时间，减少阻塞
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Health check timeout")), 1000);
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
      console.warn("[MessageStorage] 健康检查失败，但不影响存储使用:", error);
      // 健康检查失败时，仍然认为存储是可用的
      // 这样可以避免频繁刷新时的数据丢失
      return true;
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
}

// 创建全局实例
export const messageStorage = new MessageStorage();
