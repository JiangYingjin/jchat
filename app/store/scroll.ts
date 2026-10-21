/**
 * 会话滚动状态存储管理
 * 使用独立的 IndexedDB 存储，完全脱离 Zustand 体系
 */

import localforage from "localforage";
import type {
  SessionScrollBookmark,
  SessionScrollState,
} from "../types/scroll";

// 检查是否在客户端环境
const isClient = typeof window !== "undefined";

// 独立的滚动状态存储实例
let scrollStorageInstance: LocalForage | null = null;
let bookmarkStorageInstance: LocalForage | null = null;

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

const getBookmarkStorage = (): LocalForage | null => {
  if (!isClient) return null;
  if (!bookmarkStorageInstance) {
    bookmarkStorageInstance = localforage.createInstance({
      name: "JChat",
      storeName: "sessionBookmarks",
      description: "User-created session reading bookmarks",
    });
  }
  return bookmarkStorageInstance;
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

/**
 * 用户阅读书签存储：与自动恢复位置使用独立 object store，互不覆盖。
 */
class ScrollBookmarkStorage {
  async saveAll(
    sessionId: string,
    bookmarks: SessionScrollBookmark[],
  ): Promise<boolean> {
    try {
      const storage = getBookmarkStorage();
      if (!storage) return false;
      await storage.setItem(sessionId, bookmarks);
      return true;
    } catch (error) {
      debugLog("BOOKMARK_SAVE_ERROR", `保存阅读书签失败: ${error}`);
      return false;
    }
  }

  async getAll(sessionId: string): Promise<SessionScrollBookmark[]> {
    try {
      const storage = getBookmarkStorage();
      if (!storage) return [];
      const data = await storage.getItem<
        SessionScrollBookmark[] | SessionScrollBookmark
      >(sessionId);
      if (!data) return [];
      const records = Array.isArray(data) ? data : [data];
      const bookmarks = records.flatMap((record) => {
        if (
          !record ||
          record.sessionId !== sessionId ||
          typeof record.messageId !== "string" ||
          !Number.isFinite(record.messageIndex) ||
          !Number.isFinite(record.viewportOffset)
        ) {
          return [];
        }
        return [
          {
            ...record,
            id:
              typeof record.id === "string"
                ? record.id
                : `legacy-${record.messageId}-${record.createdAt}`,
            messageProgress: Number.isFinite(record.messageProgress)
              ? record.messageProgress
              : 0,
          },
        ];
      });
      if (!Array.isArray(data) || bookmarks.length !== records.length) {
        await storage.setItem(sessionId, bookmarks);
      }
      return bookmarks;
    } catch (error) {
      debugLog("BOOKMARK_GET_ERROR", `读取阅读书签失败: ${error}`);
      return [];
    }
  }

  async remove(sessionId: string, bookmarkId: string): Promise<boolean> {
    try {
      const storage = getBookmarkStorage();
      if (!storage) return false;
      const bookmarks = await this.getAll(sessionId);
      await storage.setItem(
        sessionId,
        bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
      );
      return true;
    } catch (error) {
      debugLog("BOOKMARK_REMOVE_ERROR", `删除阅读书签失败: ${error}`);
      return false;
    }
  }
}

export const scrollBookmarkStorage = new ScrollBookmarkStorage();
