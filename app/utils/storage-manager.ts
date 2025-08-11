// 统一的存储管理模块 - 合并所有存储相关功能
import localforage from "localforage";
import { jchatStorage } from "./store";
import { messageStorage } from "../store/message";

// 简化的存储状态枚举
export enum StorageStatus {
  READY = "ready",
  ERROR = "error",
  UNAVAILABLE = "unavailable",
}

// 简化的健康报告接口
export interface StorageHealth {
  status: StorageStatus;
  timestamp: number;
  errors: string[];
}

// 统一的存储管理器
class UnifiedStorageManager {
  private lastCheck = 0;
  private checkInterval = 30000; // 30秒
  private currentStatus = StorageStatus.READY;

  /**
   * 快速健康检查 - 合并原来三个文件的检查逻辑
   */
  async quickHealthCheck(): Promise<StorageHealth> {
    const now = Date.now();

    // 避免频繁检查
    if (
      now - this.lastCheck < this.checkInterval &&
      this.currentStatus === StorageStatus.READY
    ) {
      return {
        status: this.currentStatus,
        timestamp: this.lastCheck,
        errors: [],
      };
    }

    this.lastCheck = now;
    const health: StorageHealth = {
      status: StorageStatus.READY,
      timestamp: now,
      errors: [],
    };

    try {
      // 1. 检查环境可用性
      if (typeof window === "undefined" || !window.indexedDB) {
        health.status = StorageStatus.UNAVAILABLE;
        health.errors.push("IndexedDB不可用");
        return health;
      }

      // 2. 快速读写测试
      const testKey = "__unified_health_test__";
      const testData = { timestamp: now, test: true };

      await jchatStorage.setItem(testKey, testData);
      const result = await jchatStorage.getItem(testKey);
      await jchatStorage.removeItem(testKey);

      // 3. 验证数据完整性
      if (!result || typeof result !== "object" || !result.test) {
        health.status = StorageStatus.ERROR;
        health.errors.push("数据读写验证失败");
      }

      // 4. 检查消息存储
      const messageHealthy = await messageStorage
        .healthCheck()
        .catch(() => false);
      if (!messageHealthy) {
        health.errors.push("消息存储异常");
        if (health.status === StorageStatus.READY) {
          health.status = StorageStatus.ERROR;
        }
      }
    } catch (error) {
      health.status = StorageStatus.ERROR;
      health.errors.push(
        `健康检查失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.currentStatus = health.status;
    return health;
  }

  /**
   * 安全的存储操作包装器
   */
  async safeExecute<T>(
    operation: () => Promise<T>,
    fallback: T,
    maxRetries: number = 2,
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("操作超时")), 5000),
          ),
        ]);
        return result;
      } catch (error) {
        if (i === maxRetries - 1) {
          console.warn(`[存储操作] 失败，使用fallback:`, error);
          return fallback;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
      }
    }
    return fallback;
  }

  /**
   * 数据一致性验证 - 简化版本
   */
  async validateDataConsistency(
    state: any,
  ): Promise<{ valid: boolean; fixes: string[] }> {
    const fixes: string[] = [];

    try {
      // 检查基本数据结构
      if (!Array.isArray(state.sessions)) {
        throw new Error("会话数据结构损坏");
      }

      if (state.sessions.length === 0) {
        throw new Error("会话数据为空");
      }

      // 修复索引问题
      if (
        state.currentSessionIndex < 0 ||
        state.currentSessionIndex >= state.sessions.length
      ) {
        const validIndex = Math.max(
          0,
          Math.min(state.currentSessionIndex, state.sessions.length - 1),
        );
        state.currentSessionIndex = validIndex;
        fixes.push(`修复会话索引: ${validIndex}`);
      }

      // 检查组数据
      if (!Array.isArray(state.groups)) {
        throw new Error("组数据结构损坏");
      }

      if (
        state.groups.length > 0 &&
        (state.currentGroupIndex < 0 ||
          state.currentGroupIndex >= state.groups.length)
      ) {
        const validIndex = Math.max(
          0,
          Math.min(state.currentGroupIndex, state.groups.length - 1),
        );
        state.currentGroupIndex = validIndex;
        fixes.push(`修复组索引: ${validIndex}`);
      }

      return { valid: true, fixes };
    } catch (error) {
      console.error("[数据一致性] 验证失败:", error);
      return { valid: false, fixes };
    }
  }

  /**
   * 自动修复存储问题
   */
  async attemptRepair(): Promise<boolean> {
    try {
      // 清理测试数据
      await jchatStorage.removeItem("__unified_health_test__");

      // 重新初始化 localforage 实例
      const storageNames = [
        "default",
        "messages",
        "systemMessages",
        "chatInput",
      ];
      for (const name of storageNames) {
        const storage = localforage.createInstance({
          name: "JChat",
          storeName: name,
        });
        await storage.ready();
      }

      // 重新检查健康状态
      const health = await this.quickHealthCheck();
      return health.status !== StorageStatus.ERROR;
    } catch (error) {
      console.error("[存储修复] 失败:", error);
      return false;
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): StorageStatus {
    return this.currentStatus;
  }

  /**
   * 强制设置状态
   */
  setStatus(status: StorageStatus): void {
    this.currentStatus = status;
  }
}

// 导出单例实例
export const storageManager = new UnifiedStorageManager();

// 向后兼容的导出
export const storageHealthManager = {
  checkHealth: () => storageManager.quickHealthCheck(),
  attemptRepair: () => storageManager.attemptRepair(),
  getHealthStatus: () => storageManager.getStatus() === StorageStatus.READY,
};

export default storageManager;
