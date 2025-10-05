/**
 * 滚动状态管理 Hook
 * 提供防抖保存和智能恢复功能
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import type { SessionScrollState } from "../types/scroll";

// 防抖配置
const DEBOUNCE_DELAY = 800; // 增加防抖延迟，减少频繁保存

// 调试日志函数 - 只在开发环境输出
const debugLog = (action: string, data?: any) => {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEBUG_SCROLL === "true"
  ) {
    console.log(`[useScrollState][${action}]`, data);
  }
};

/**
 * 滚动状态管理 Hook
 */
export function useScrollState(sessionId: string) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [lastSavedState, setLastSavedState] =
    useState<SessionScrollState | null>(null);

  // 用于跟踪当前会话的滚动状态
  const currentScrollStateRef = useRef<SessionScrollState | null>(null);

  /**
   * 防抖保存滚动状态（优化版：避免触发 ChatStore 完整持久化）
   */
  const debouncedSave = useDebouncedCallback(
    async (scrollTop: number, messageIndex: number, viewportHeight: number) => {
      try {
        // 检查是否与上次保存的状态相同，避免重复保存
        const currentState = currentScrollStateRef.current;
        if (
          currentState &&
          currentState.scrollTop === scrollTop &&
          currentState.messageIndex === messageIndex &&
          currentState.viewportHeight === viewportHeight
        ) {
          debugLog("DEBOUNCED_SAVE_SKIP", "状态未变化，跳过保存");
          return;
        }

        debugLog("DEBOUNCED_SAVE_START", {
          sessionId,
          scrollTop,
          messageIndex,
          viewportHeight,
        });

        // 创建滚动状态对象
        const scrollState: SessionScrollState = {
          sessionId,
          scrollTop,
          messageIndex,
          viewportHeight,
          timestamp: Date.now(),
        };

        // 完全脱离 Zustand 体系，直接保存到存储
        const { scrollStorage } = await import("../store/scroll");
        const success = await scrollStorage.save(sessionId, scrollState);

        if (success) {
          currentScrollStateRef.current = scrollState;
          setLastSavedState(scrollState);

          debugLog("DEBOUNCED_SAVE_SUCCESS", {
            sessionId,
            scrollTop,
            messageIndex,
          });
        } else {
          debugLog("DEBOUNCED_SAVE_ERROR", "防抖保存失败");
        }
      } catch (error) {
        debugLog("DEBOUNCED_SAVE_ERROR", `防抖保存异常: ${error}`);
      }
    },
    DEBOUNCE_DELAY,
    {
      leading: false,
      trailing: true,
    },
  );

  /**
   * 立即保存滚动状态（用于会话切换等关键时机）
   */
  const saveImmediately = useCallback(
    async (scrollTop: number, messageIndex: number, viewportHeight: number) => {
      try {
        debugLog("IMMEDIATE_SAVE_START", {
          sessionId,
          scrollTop,
          messageIndex,
          viewportHeight,
        });

        // 取消防抖保存
        debouncedSave.cancel();

        // 创建滚动状态对象
        const scrollState: SessionScrollState = {
          sessionId,
          scrollTop,
          messageIndex,
          viewportHeight,
          timestamp: Date.now(),
        };

        // 完全脱离 Zustand 体系，直接保存到存储
        const { scrollStorage } = await import("../store/scroll");
        const success = await scrollStorage.save(sessionId, scrollState);

        if (success) {
          const newState: SessionScrollState = {
            sessionId,
            scrollTop,
            messageIndex,
            viewportHeight,
            timestamp: Date.now(),
          };

          currentScrollStateRef.current = newState;
          setLastSavedState(newState);

          debugLog("IMMEDIATE_SAVE_SUCCESS", {
            sessionId,
            scrollTop,
            messageIndex,
          });
        } else {
          debugLog("IMMEDIATE_SAVE_ERROR", "立即保存失败");
        }

        return success;
      } catch (error) {
        debugLog("IMMEDIATE_SAVE_ERROR", `立即保存异常: ${error}`);
        return false;
      }
    },
    [sessionId, debouncedSave],
  );

  /**
   * 恢复滚动状态
   */
  const restoreScrollState = useCallback(async () => {
    try {
      setIsRestoring(true);

      debugLog("RESTORE_START", { sessionId });

      // 直接从存储获取
      const { scrollStorage } = await import("../store/scroll");
      const scrollState = await scrollStorage.get(sessionId);

      debugLog("RESTORE_STORAGE_RESULT", {
        sessionId,
        storageState: scrollState,
        hasStorageState: !!scrollState,
      });

      if (scrollState) {
        currentScrollStateRef.current = scrollState;
        setLastSavedState(scrollState);

        debugLog("RESTORE_SUCCESS", {
          sessionId,
          scrollTop: scrollState.scrollTop,
          messageIndex: scrollState.messageIndex,
          viewportHeight: scrollState.viewportHeight,
          timestamp: scrollState.timestamp,
        });

        return scrollState;
      } else {
        debugLog("RESTORE_NOT_FOUND", { sessionId });
        return null;
      }
    } catch (error) {
      debugLog("RESTORE_ERROR", `恢复滚动状态异常: ${error}`);
      return null;
    } finally {
      setIsRestoring(false);
    }
  }, [sessionId]);

  /**
   * 获取当前滚动状态
   */
  const getCurrentScrollState = useCallback(() => {
    return currentScrollStateRef.current;
  }, []);

  /**
   * 检查是否有未保存的更改
   */
  const hasUnsavedChanges = useCallback(() => {
    return debouncedSave.isPending();
  }, [debouncedSave]);

  /**
   * 强制保存所有待处理的更改
   */
  const flushPendingSaves = useCallback(async () => {
    try {
      debugLog("FLUSH_START", { sessionId });

      // 取消防抖，立即执行
      debouncedSave.flush();

      debugLog("FLUSH_SUCCESS", { sessionId });
    } catch (error) {
      debugLog("FLUSH_ERROR", `强制保存异常: ${error}`);
    }
  }, [sessionId, debouncedSave]);

  /**
   * 会话切换时自动保存当前状态
   */
  useEffect(() => {
    return () => {
      // 组件卸载时强制保存
      if (hasUnsavedChanges()) {
        flushPendingSaves();
      }
    };
  }, [hasUnsavedChanges, flushPendingSaves]);

  /**
   * 页面卸载时保存状态
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasUnsavedChanges()) {
        flushPendingSaves();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges, flushPendingSaves]);

  return {
    // 状态
    isRestoring,
    lastSavedState,
    hasUnsavedChanges: hasUnsavedChanges(),

    // 方法
    saveScrollState: debouncedSave,
    saveImmediately,
    restoreScrollState,
    getCurrentScrollState,
    flushPendingSaves,
  };
}
