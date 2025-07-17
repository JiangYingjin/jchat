// 存储辅助工具，用于处理存储相关问题
import { messageStorage } from "../store/message";
import { jchatStorage } from "./store";

// 存储健康状态跟踪
export class StorageHealthManager {
  private static instance: StorageHealthManager;
  private isHealthy: boolean = true;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30秒检查一次
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1秒重试间隔

  private constructor() {}

  static getInstance(): StorageHealthManager {
    if (!StorageHealthManager.instance) {
      StorageHealthManager.instance = new StorageHealthManager();
    }
    return StorageHealthManager.instance;
  }

  async checkHealth(): Promise<boolean> {
    const now = Date.now();

    // 避免频繁检查
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isHealthy;
    }

    this.lastHealthCheck = now;

    try {
      // 执行健康检查
      const isHealthy = await messageStorage.healthCheck();
      this.isHealthy = isHealthy;

      if (!isHealthy) {
        console.warn("[StorageHealthManager] 存储系统异常，启动修复流程");
        await this.attemptRepair();
      }

      return this.isHealthy;
    } catch (error) {
      console.error("[StorageHealthManager] 健康检查失败:", error);
      this.isHealthy = false;
      return false;
    }
  }

  private async attemptRepair(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(
          `[StorageHealthManager] 修复尝试 ${attempt}/${this.maxRetries}`,
        );

        // 尝试重新初始化存储
        await this.reinitializeStorage();

        // 重新检查健康状态
        const isHealthy = await messageStorage.healthCheck();
        if (isHealthy) {
          console.log("[StorageHealthManager] 存储修复成功");
          this.isHealthy = true;
          return;
        }
      } catch (error) {
        console.error(
          `[StorageHealthManager] 修复尝试 ${attempt} 失败:`,
          error,
        );
      }

      // 等待后重试
      if (attempt < this.maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * attempt),
        );
      }
    }

    console.error("[StorageHealthManager] 所有修复尝试均失败");
  }

  private async reinitializeStorage(): Promise<void> {
    // 清理可能损坏的存储实例
    if (typeof window !== "undefined") {
      try {
        // 强制重新初始化 IndexedDB 连接
        await new Promise((resolve) => setTimeout(resolve, 100));

        // 尝试执行一个简单的存储操作测试
        await jchatStorage.setItem("__health_test__", Date.now());
        await jchatStorage.getItem("__health_test__");
        await jchatStorage.removeItem("__health_test__");
      } catch (error) {
        throw new Error(
          `存储重新初始化失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  getHealthStatus(): boolean {
    return this.isHealthy;
  }

  forceSetHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }
}

// 安全的存储操作包装器
export class SafeStorageWrapper {
  private healthManager: StorageHealthManager;

  constructor() {
    this.healthManager = StorageHealthManager.getInstance();
  }

  async safeExecute<T>(
    operation: () => Promise<T>,
    fallback: T,
    operationName: string = "unknown",
  ): Promise<T> {
    try {
      // 检查存储健康状态
      const isHealthy = await this.healthManager.checkHealth();
      if (!isHealthy) {
        console.warn(
          `[SafeStorageWrapper] 存储不健康，使用fallback for ${operationName}`,
        );
        return fallback;
      }

      return await operation();
    } catch (error) {
      console.error(`[SafeStorageWrapper] 操作 ${operationName} 失败:`, error);

      // 标记存储为不健康
      this.healthManager.forceSetHealthy(false);

      return fallback;
    }
  }
}

// 防抖函数，用于减少频繁的存储操作
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
  immediate: boolean = false,
): T {
  let timeout: NodeJS.Timeout | null;

  return ((...args: any[]) => {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };

    const callNow = immediate && !timeout;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);

    if (callNow) {
      func(...args);
    }
  }) as T;
}

// 数据一致性检查器
export class DataConsistencyChecker {
  static async checkSessionDataConsistency(
    sessionId: string,
  ): Promise<boolean> {
    try {
      // 检查消息数据是否存在
      const messages = await messageStorage.get(sessionId);

      // 检查是否有基本的数据结构
      if (!Array.isArray(messages)) {
        console.warn(
          `[DataConsistencyChecker] 会话 ${sessionId} 消息数据格式异常`,
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `[DataConsistencyChecker] 检查会话 ${sessionId} 数据一致性失败:`,
        error,
      );
      return false;
    }
  }
}

// 导出单例实例
export const storageHealthManager = StorageHealthManager.getInstance();
export const safeStorageWrapper = new SafeStorageWrapper();
