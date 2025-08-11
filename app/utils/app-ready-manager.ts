// 简化的应用准备状态管理
import { storageManager, StorageStatus } from "./storage-manager";

// 应用准备状态
export enum AppReadyStatus {
  PENDING = "pending",
  READY = "ready",
  ERROR = "error",
}

// 应用准备管理器
class AppReadyManager {
  private status = AppReadyStatus.PENDING;
  private promise: Promise<void> | null = null;
  private callbacks: (() => void)[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private readonly TIMEOUT_MS = 8000; // 8秒超时

  /**
   * 核心准备流程 - 简化版本
   */
  async ensureReady(): Promise<void> {
    if (this.status === AppReadyStatus.READY) {
      return Promise.resolve();
    }

    if (this.promise) {
      return this.promise;
    }

    this.promise = this.performReadyCheck();
    return this.promise;
  }

  private async performReadyCheck(): Promise<void> {
    try {
      console.log("[AppReady] 开始应用准备流程");

      // 启动超时保护
      this.startTimeout();

      // 1. 等待 DOM 准备
      await this.waitForDOM();

      // 2. 检查存储系统
      const health = await storageManager.quickHealthCheck();
      if (health.status === StorageStatus.UNAVAILABLE) {
        throw new Error("存储系统不可用");
      }

      // 3. 等待 Zustand 水合（如果需要）
      await this.waitForHydration();

      // 4. 基本数据验证（在实际使用时由调用方提供验证函数）
      await this.validateBasicData();

      // 标记准备完成
      this.setReady();
      console.log("[AppReady] ✅ 应用准备完成");
    } catch (error) {
      console.error("[AppReady] ❌ 应用准备失败:", error);
      this.status = AppReadyStatus.ERROR;

      // 错误时也触发回调，避免无限等待
      this.triggerCallbacks();
      throw error;
    } finally {
      this.clearTimeout();
      this.promise = null;
    }
  }

  private async waitForDOM(): Promise<void> {
    if (typeof document === "undefined") return;

    return new Promise<void>((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => resolve(), {
          once: true,
        });
      } else {
        resolve();
      }
    });
  }

  private async waitForHydration(): Promise<void> {
    // 这里可以集成具体的水合检查逻辑
    // 为了简化，暂时用一个短延迟
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  private async validateBasicData(): Promise<void> {
    // 基本的环境检查
    if (typeof window === "undefined") {
      throw new Error("非浏览器环境");
    }

    // 存储可用性最终确认
    const health = await storageManager.quickHealthCheck();
    if (health.status === StorageStatus.ERROR) {
      console.warn("[AppReady] 存储有问题但继续启动:", health.errors);
    }
  }

  private setReady(): void {
    this.status = AppReadyStatus.READY;

    // 设置全局标记
    if (typeof window !== "undefined") {
      (window as any).__jchat_app_ready = true;
    }

    this.triggerCallbacks();
  }

  private triggerCallbacks(): void {
    const callbacks = [...this.callbacks];
    this.callbacks.length = 0;

    callbacks.forEach((callback, index) => {
      try {
        callback();
      } catch (error) {
        console.error(`[AppReady] 回调 ${index} 执行失败:`, error);
      }
    });
  }

  private startTimeout(): void {
    this.timeout = setTimeout(() => {
      console.warn("[AppReady] ⚠️ 应用准备超时，强制刷新页面");
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }, this.TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /**
   * 等待应用准备完成
   */
  async waitForReady(): Promise<void> {
    if (this.status === AppReadyStatus.READY) {
      return Promise.resolve();
    }

    if (this.promise) {
      return this.promise;
    }

    return new Promise<void>((resolve) => {
      this.callbacks.push(resolve);
    });
  }

  /**
   * 检查是否已准备完成
   */
  isReady(): boolean {
    return this.status === AppReadyStatus.READY;
  }

  /**
   * 获取当前状态
   */
  getStatus(): AppReadyStatus {
    return this.status;
  }

  /**
   * 注册数据验证函数（可选）
   */
  registerDataValidator(validator: () => Promise<void> | void): void {
    const originalValidate = this.validateBasicData.bind(this);
    this.validateBasicData = async () => {
      await originalValidate();
      await validator();
    };
  }
}

// 导出单例实例
export const appReadyManager = new AppReadyManager();

// 便捷函数导出
export const waitForAppReady = () => appReadyManager.waitForReady();
export const isAppReady = () => appReadyManager.isReady();
export const ensureAppReady = () => appReadyManager.ensureReady();

export default appReadyManager;
