/**
 * 会话滚动状态存储管理
 * 使用独立的 IndexedDB 存储，完全脱离 Zustand 体系
 */

import localforage from "localforage";
import type { SessionScrollState } from "../types/scroll";

// 检查是否在客户端环境
const isClient = typeof window !== "undefined";

// 独立的滚动状态存储实例
let scrollStorageInstance: LocalForage | null = null;

const getScrollStorage = (): LocalForage | null => {
  if (!isClient) return null;
  if (!scrollStorageInstance) {
    scrollStorageInstance = localforage.createInstance({
      name: "JChat",
      storeName: "sessionScroll",
      description: "Session scroll states storage",
    });
  }
  return scrollStorageInstance;
};

import { createModuleLogger } from "../utils/logger";

// 创建滚动模块日志器 - 自动检测 NEXT_PUBLIC_DEBUG_SCROLL 环境变量
const scrollLogger = createModuleLogger("SCROLL");

// 使用模块化日志系统 - 支持细粒度控制
const debugLog = (action: string, data?: any) => {
  scrollLogger.debug("SCROLL", action, data);
};

/**
 * 滚动状态存储接口
 */
export interface ScrollStateStorage {
  save(sessionId: string, state: SessionScrollState): Promise<boolean>;
  get(sessionId: string): Promise<SessionScrollState | null>;
}

/**
 * 基于独立 IndexedDB 的滚动状态存储实现
 * 完全脱离 Zustand 体系，避免触发完整状态持久化
 */
class ScrollStorage implements ScrollStateStorage {
  async save(
    sessionId: string,
    scrollState: SessionScrollState,
  ): Promise<boolean> {
    try {
      const storage = getScrollStorage();
      if (!storage) {
        debugLog("SAVE_ERROR", "存储不可用（服务器端）");
        return false;
      }

      // 数据未恢复时，禁止数据持久化
      if (
        typeof window !== "undefined" &&
        (window as any).__jchat_data_restored !== true
      ) {
        debugLog("SAVE_ERROR", `数据未恢复，禁止数据持久化: ${sessionId}`);
        return false;
      }

      // 直接使用 sessionId 作为键，无需前缀
      await storage.setItem(sessionId, scrollState);

      debugLog("SAVE_SUCCESS", {
        sessionId,
        scrollTop: scrollState.scrollTop,
        messageIndex: scrollState.messageIndex,
        viewportHeight: scrollState.viewportHeight,
      });
      return true;
    } catch (error) {
      debugLog("SAVE_ERROR", `保存滚动状态失败: ${error}`);
      return false;
    }
  }

  async get(sessionId: string): Promise<SessionScrollState | null> {
    try {
      const storage = getScrollStorage();
      if (!storage) {
        debugLog("GET_ERROR", "存储不可用（服务器端）");
        return null;
      }

      // 直接使用 sessionId 作为键
      const data = await storage.getItem(sessionId);

      if (data && typeof data === "object") {
        const scrollState = data as SessionScrollState;
        debugLog("GET_SUCCESS", {
          sessionId,
          scrollTop: scrollState.scrollTop,
          messageIndex: scrollState.messageIndex,
          viewportHeight: scrollState.viewportHeight,
        });
        return scrollState;
      }

      debugLog("GET_NOT_FOUND", { sessionId });
      return null;
    } catch (error) {
      debugLog("GET_ERROR", `获取滚动状态失败: ${error}`);
      return null;
    }
  }
}

// 导出存储实例
export const scrollStorage = new ScrollStorage();
