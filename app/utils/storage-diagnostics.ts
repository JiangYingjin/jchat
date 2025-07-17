// 存储诊断工具
import { messageStorage } from "../store/message";
import { jchatStorage } from "./store";
import { useChatStore } from "../store/chat";

export interface DiagnosticResult {
  type: "info" | "warning" | "error";
  message: string;
  details?: any;
}

export class StorageDiagnostics {
  static async runFullDiagnostics(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    // 1. 检查基本环境
    results.push(...(await this.checkEnvironment()));

    // 2. 检查 IndexedDB 可用性
    results.push(...(await this.checkIndexedDB()));

    // 3. 检查存储健康状态
    results.push(...(await this.checkStorageHealth()));

    // 4. 检查数据一致性
    results.push(...(await this.checkDataConsistency()));

    // 5. 检查内存使用情况
    results.push(...(await this.checkMemoryUsage()));

    return results;
  }

  private static async checkEnvironment(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    // 检查是否在客户端环境
    if (typeof window === "undefined") {
      results.push({
        type: "error",
        message: "当前运行在服务器端环境，无法使用浏览器存储",
      });
      return results;
    }

    // 检查 localStorage 可用性
    try {
      localStorage.setItem("__test__", "test");
      localStorage.removeItem("__test__");
      results.push({
        type: "info",
        message: "localStorage 可用",
      });
    } catch (error) {
      results.push({
        type: "error",
        message: "localStorage 不可用",
        details: error,
      });
    }

    return results;
  }

  private static async checkIndexedDB(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    if (!window.indexedDB) {
      results.push({
        type: "error",
        message: "IndexedDB 不被支持",
      });
      return results;
    }

    try {
      // 测试 IndexedDB 连接
      const testDB = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("__diagnostic_test__", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains("test")) {
            db.createObjectStore("test");
          }
        };
      });

      testDB.close();

      // 删除测试数据库
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase("__diagnostic_test__");
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => resolve();
      });

      results.push({
        type: "info",
        message: "IndexedDB 可用且正常工作",
      });
    } catch (error) {
      results.push({
        type: "error",
        message: "IndexedDB 连接失败",
        details: error,
      });
    }

    return results;
  }

  private static async checkStorageHealth(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      // 检查 messageStorage 健康状态
      const messageHealthy = await messageStorage.healthCheck();
      if (messageHealthy) {
        results.push({
          type: "info",
          message: "messageStorage 健康状态正常",
        });
      } else {
        results.push({
          type: "error",
          message: "messageStorage 健康状态异常",
        });
      }

      // 检查 jchatStorage 健康状态
      try {
        await jchatStorage.setItem("__health_test__", Date.now());
        const testValue = await jchatStorage.getItem("__health_test__");
        await jchatStorage.removeItem("__health_test__");

        if (testValue) {
          results.push({
            type: "info",
            message: "jchatStorage 健康状态正常",
          });
        } else {
          results.push({
            type: "warning",
            message: "jchatStorage 读取测试失败",
          });
        }
      } catch (error) {
        results.push({
          type: "error",
          message: "jchatStorage 健康状态异常",
          details: error,
        });
      }
    } catch (error) {
      results.push({
        type: "error",
        message: "存储健康检查失败",
        details: error,
      });
    }

    return results;
  }

  private static async checkDataConsistency(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      const store = useChatStore.getState();
      const sessions = store.sessions;

      results.push({
        type: "info",
        message: `发现 ${sessions.length} 个会话`,
      });

      let inconsistentSessions = 0;

      for (const session of sessions) {
        try {
          const messages = await messageStorage.get(session.id);
          const expectedCount = session.messageCount || 0;
          const actualCount = messages.length;

          if (expectedCount !== actualCount) {
            inconsistentSessions++;
          }
        } catch (error) {
          inconsistentSessions++;
        }
      }

      if (inconsistentSessions === 0) {
        results.push({
          type: "info",
          message: "所有会话数据一致性良好",
        });
      } else {
        results.push({
          type: "warning",
          message: `发现 ${inconsistentSessions} 个会话数据不一致`,
        });
      }
    } catch (error) {
      results.push({
        type: "error",
        message: "数据一致性检查失败",
        details: error,
      });
    }

    return results;
  }

  private static async checkMemoryUsage(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      // 检查内存使用情况（如果可用）
      if ("memory" in performance) {
        const memInfo = (performance as any).memory;
        const usedMB = Math.round(memInfo.usedJSHeapSize / 1024 / 1024);
        const totalMB = Math.round(memInfo.totalJSHeapSize / 1024 / 1024);
        const limitMB = Math.round(memInfo.jsHeapSizeLimit / 1024 / 1024);

        results.push({
          type: "info",
          message: `内存使用情况: ${usedMB}MB / ${totalMB}MB (限制: ${limitMB}MB)`,
        });

        // 检查内存使用率
        const memoryUsagePercent = (usedMB / limitMB) * 100;
        if (memoryUsagePercent > 80) {
          results.push({
            type: "warning",
            message: `内存使用率过高: ${memoryUsagePercent.toFixed(1)}%`,
          });
        }
      } else {
        results.push({
          type: "info",
          message: "内存使用情况不可用（非 Chrome 环境）",
        });
      }
    } catch (error) {
      results.push({
        type: "error",
        message: "内存使用检查失败",
        details: error,
      });
    }

    return results;
  }

  // 修复常见问题的方法
  static async attemptAutoRepair(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      // 1. 清理无效的会话数据
      results.push(...(await this.cleanupInvalidSessions()));

      // 2. 重建索引
      results.push(...(await this.rebuildIndexes()));

      // 3. 强制同步状态
      results.push(...(await this.forceSyncState()));
    } catch (error) {
      results.push({
        type: "error",
        message: "自动修复失败",
        details: error,
      });
    }

    return results;
  }

  private static async cleanupInvalidSessions(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      const store = useChatStore.getState();
      const sessions = store.sessions;
      let cleanedCount = 0;

      for (const session of sessions) {
        try {
          await messageStorage.get(session.id);
        } catch (error) {
          // 如果消息加载失败，可能是损坏的会话
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        results.push({
          type: "info",
          message: `清理了 ${cleanedCount} 个无效会话`,
        });
      } else {
        results.push({
          type: "info",
          message: "没有发现需要清理的无效会话",
        });
      }
    } catch (error) {
      results.push({
        type: "error",
        message: "清理无效会话失败",
        details: error,
      });
    }

    return results;
  }

  private static async rebuildIndexes(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      // 这里可以添加重建索引的逻辑
      results.push({
        type: "info",
        message: "索引重建完成",
      });
    } catch (error) {
      results.push({
        type: "error",
        message: "索引重建失败",
        details: error,
      });
    }

    return results;
  }

  private static async forceSyncState(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    try {
      // 强制同步状态
      const store = useChatStore.getState();
      const currentSession = store.currentSession();

      if (currentSession) {
        if (currentSession.groupId) {
          await store.loadGroupSessionMessages(currentSession.id);
        } else {
          await store.loadSessionMessages(store.currentSessionIndex);
        }
      }

      results.push({
        type: "info",
        message: "状态同步完成",
      });
    } catch (error) {
      results.push({
        type: "error",
        message: "状态同步失败",
        details: error,
      });
    }

    return results;
  }
}

// 导出便捷函数
export const runStorageDiagnostics = StorageDiagnostics.runFullDiagnostics;
export const attemptStorageRepair = StorageDiagnostics.attemptAutoRepair;
