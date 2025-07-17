import localforage from "localforage";
import { jchatStorage } from "./store";

// 存储健康状态枚举
export enum StorageHealthStatus {
  HEALTHY = "healthy",
  WARNING = "warning",
  ERROR = "error",
  UNAVAILABLE = "unavailable",
}

// 存储健康报告接口
export interface StorageHealthReport {
  status: StorageHealthStatus;
  timestamp: number;
  checks: {
    availability: boolean;
    readWrite: boolean;
    dataIntegrity: boolean;
    performance: boolean;
  };
  details: {
    availableStorages: string[];
    failedStorages: string[];
    performanceMetrics: {
      readTime: number;
      writeTime: number;
    };
    errors: string[];
    warnings: string[];
  };
}

// 存储健康管理器
class StorageHealthManager {
  private readonly TEST_KEY = "__jchat_health_test__";
  private readonly TEST_DATA = { timestamp: Date.now(), test: true };
  private readonly PERFORMANCE_THRESHOLD = 1000; // 1秒

  private lastHealthReport: StorageHealthReport | null = null;
  private healthCheckInterval: number | null = null;

  /**
   * 执行完整的存储健康检查
   */
  async checkHealth(): Promise<StorageHealthReport> {
    const report: StorageHealthReport = {
      status: StorageHealthStatus.HEALTHY,
      timestamp: Date.now(),
      checks: {
        availability: false,
        readWrite: false,
        dataIntegrity: false,
        performance: false,
      },
      details: {
        availableStorages: [],
        failedStorages: [],
        performanceMetrics: {
          readTime: 0,
          writeTime: 0,
        },
        errors: [],
        warnings: [],
      },
    };

    try {
      // 1. 检查存储可用性
      report.checks.availability = await this.checkAvailability(report.details);

      // 2. 检查读写操作
      if (report.checks.availability) {
        report.checks.readWrite = await this.checkReadWrite(report.details);
      }

      // 3. 检查数据完整性
      if (report.checks.readWrite) {
        report.checks.dataIntegrity = await this.checkDataIntegrity(
          report.details,
        );
      }

      // 4. 检查性能
      if (report.checks.readWrite) {
        report.checks.performance = await this.checkPerformance(report.details);
      }

      // 根据检查结果确定整体状态
      report.status = this.calculateOverallStatus(report);
    } catch (error) {
      report.status = StorageHealthStatus.ERROR;
      report.details.errors.push(`Health check failed: ${error}`);
    }

    this.lastHealthReport = report;
    return report;
  }

  /**
   * 检查存储可用性
   */
  private async checkAvailability(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    const storageNames = ["default", "messages", "systemMessages", "chatInput"];
    let availableCount = 0;

    for (const name of storageNames) {
      try {
        const storage = localforage.createInstance({
          name: "JChat",
          storeName: name,
        });

        // 尝试获取存储状态
        await storage.ready();
        details.availableStorages.push(name);
        availableCount++;
      } catch (error) {
        details.failedStorages.push(name);
        details.errors.push(`Storage ${name} unavailable: ${error}`);
      }
    }

    return availableCount > 0;
  }

  /**
   * 检查读写操作
   */
  private async checkReadWrite(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    try {
      const storage = localforage.createInstance({
        name: "JChat",
        storeName: "default",
      });

      // 测试写入
      const writeStart = Date.now();
      await storage.setItem(this.TEST_KEY, this.TEST_DATA);
      const writeTime = Date.now() - writeStart;

      // 测试读取
      const readStart = Date.now();
      const readData = await storage.getItem(this.TEST_KEY);
      const readTime = Date.now() - readStart;

      // 清理测试数据
      await storage.removeItem(this.TEST_KEY);

      // 验证数据完整性
      const isDataValid =
        readData &&
        typeof readData === "object" &&
        (readData as any).test === true;

      if (!isDataValid) {
        details.errors.push("Read/write test failed: data corruption detected");
        return false;
      }

      details.performanceMetrics.readTime = readTime;
      details.performanceMetrics.writeTime = writeTime;

      return true;
    } catch (error) {
      details.errors.push(`Read/write test failed: ${error}`);
      return false;
    }
  }

  /**
   * 检查数据完整性
   */
  private async checkDataIntegrity(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    try {
      // 随机检查一些存储项的完整性
      const checks = [
        this.checkChatStoreIntegrity(details),
        this.checkMessageStorageIntegrity(details),
      ];

      const results = await Promise.allSettled(checks);
      let passCount = 0;

      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          passCount++;
        } else if (result.status === "rejected") {
          details.warnings.push(
            `Integrity check ${index + 1} failed: ${result.reason}`,
          );
        }
      });

      return passCount >= results.length * 0.5; // 至少50%的检查通过
    } catch (error) {
      details.errors.push(`Data integrity check failed: ${error}`);
      return false;
    }
  }

  /**
   * 检查聊天存储的完整性
   */
  private async checkChatStoreIntegrity(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    try {
      const chatData = await jchatStorage.getItem("chat-store");
      if (!chatData) {
        return true; // 空数据也算正常
      }

      // 检查基本结构
      if (typeof chatData !== "object" || !chatData.state) {
        details.warnings.push("Chat store structure is invalid");
        return false;
      }

      const state = chatData.state;

      // 检查必需字段
      if (!Array.isArray(state.sessions) || !Array.isArray(state.groups)) {
        details.warnings.push(
          "Chat store sessions or groups structure is invalid",
        );
        return false;
      }

      return true;
    } catch (error) {
      details.warnings.push(`Chat store integrity check failed: ${error}`);
      return false;
    }
  }

  /**
   * 检查消息存储的完整性
   */
  private async checkMessageStorageIntegrity(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    try {
      const storage = localforage.createInstance({
        name: "JChat",
        storeName: "messages",
      });

      const keys = await storage.keys();
      if (keys.length === 0) {
        return true; // 空存储也算正常
      }

      // 随机检查一些消息
      const sampleKeys = keys.slice(0, Math.min(3, keys.length));

      for (const key of sampleKeys) {
        const messages = await storage.getItem(key);
        if (messages && !Array.isArray(messages)) {
          details.warnings.push(`Message data for ${key} is not an array`);
          return false;
        }
      }

      return true;
    } catch (error) {
      details.warnings.push(`Message storage integrity check failed: ${error}`);
      return false;
    }
  }

  /**
   * 检查性能
   */
  private async checkPerformance(
    details: StorageHealthReport["details"],
  ): Promise<boolean> {
    const { readTime, writeTime } = details.performanceMetrics;

    if (readTime > this.PERFORMANCE_THRESHOLD) {
      details.warnings.push(`Read performance is slow: ${readTime}ms`);
    }

    if (writeTime > this.PERFORMANCE_THRESHOLD) {
      details.warnings.push(`Write performance is slow: ${writeTime}ms`);
    }

    return readTime + writeTime < this.PERFORMANCE_THRESHOLD * 2;
  }

  /**
   * 计算整体状态
   */
  private calculateOverallStatus(
    report: StorageHealthReport,
  ): StorageHealthStatus {
    if (!report.checks.availability) {
      return StorageHealthStatus.UNAVAILABLE;
    }

    if (!report.checks.readWrite) {
      return StorageHealthStatus.ERROR;
    }

    if (report.details.errors.length > 0) {
      return StorageHealthStatus.ERROR;
    }

    if (
      report.details.warnings.length > 0 ||
      !report.checks.dataIntegrity ||
      !report.checks.performance
    ) {
      return StorageHealthStatus.WARNING;
    }

    return StorageHealthStatus.HEALTHY;
  }

  /**
   * 获取上次健康检查报告
   */
  getLastHealthReport(): StorageHealthReport | null {
    return this.lastHealthReport;
  }

  /**
   * 启动定期健康检查
   */
  startPeriodicHealthCheck(intervalMs: number = 60000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = window.setInterval(() => {
      this.checkHealth().catch((error) => {
        console.warn("[StorageHealth] Periodic health check failed:", error);
      });
    }, intervalMs);
  }

  /**
   * 停止定期健康检查
   */
  stopPeriodicHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * 尝试修复存储问题
   */
  async attemptRepair(): Promise<boolean> {
    try {
      console.log("[StorageHealth] Attempting storage repair...");

      // 1. 清理损坏的数据
      await this.cleanupCorruptedData();

      // 2. 重新初始化存储
      await this.reinitializeStorage();

      // 3. 验证修复结果
      const healthReport = await this.checkHealth();

      return (
        healthReport.status === StorageHealthStatus.HEALTHY ||
        healthReport.status === StorageHealthStatus.WARNING
      );
    } catch (error) {
      console.error("[StorageHealth] Storage repair failed:", error);
      return false;
    }
  }

  /**
   * 清理损坏的数据
   */
  private async cleanupCorruptedData(): Promise<void> {
    const storageNames = ["default", "messages", "systemMessages", "chatInput"];

    for (const name of storageNames) {
      try {
        const storage = localforage.createInstance({
          name: "JChat",
          storeName: name,
        });

        const keys = await storage.keys();

        for (const key of keys) {
          try {
            const data = await storage.getItem(key);
            // 如果数据无法序列化，说明可能损坏
            JSON.stringify(data);
          } catch {
            console.warn(
              `[StorageHealth] Removing corrupted data: ${name}.${key}`,
            );
            await storage.removeItem(key);
          }
        }
      } catch (error) {
        console.warn(
          `[StorageHealth] Failed to cleanup storage ${name}:`,
          error,
        );
      }
    }
  }

  /**
   * 重新初始化存储
   */
  private async reinitializeStorage(): Promise<void> {
    try {
      // 重新创建各个存储实例
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
    } catch (error) {
      console.error("[StorageHealth] Failed to reinitialize storage:", error);
      throw error;
    }
  }
}

// 创建全局实例
export const storageHealthManager = new StorageHealthManager();

// 向后兼容的导出
export default storageHealthManager;
