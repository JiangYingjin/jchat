import { useState, useEffect } from "react";
import { waitForAppReady, isAppReady } from "../utils/app-ready-manager";

/**
 * Hook: 检查应用是否完全准备就绪
 *
 * 用法：
 * const { isReady, isInitialized, error } = useAppReady();
 *
 * - isReady: 应用是否完全准备就绪
 * - isInitialized: 是否已开始初始化检查
 * - error: 准备过程中的错误信息
 */
export function useAppReady() {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 先检查是否已经准备好
    if (isAppReady()) {
      setIsReady(true);
      setIsInitialized(true);
      return;
    }

    // 如果还没准备好，等待应用准备完成
    setIsInitialized(true);

    waitForAppReady()
      .then(() => {
        setIsReady(true);
        setError(null);
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("[useAppReady] 等待应用准备失败:", errorMessage);
        setError(errorMessage);

        // 即使失败，也设置为已准备，避免无限等待
        // 但保留错误信息供组件决定如何处理
        setIsReady(true);
      });
  }, []);

  return { isReady, isInitialized, error };
}

/**
 * Hook: 简化版应用准备检查，只返回是否准备好
 *
 * 用法：
 * const isAppReady = useAppReadySimple();
 * if (!isAppReady) return <Loading />;
 */
export function useAppReadySimple(): boolean {
  const { isReady } = useAppReady();
  return isReady;
}

/**
 * Hook: 应用准备状态检查，带有渲染保护
 *
 * 用法：
 * const AppReadyWrapper = ({ children }) => {
 *   const renderContent = useAppReadyGuard();
 *   return renderContent ? children : <Loading />;
 * };
 */
export function useAppReadyGuard(): boolean {
  const { isReady, isInitialized } = useAppReady();

  // 只有在完全准备好时才返回 true
  return isInitialized && isReady;
}

/**
 * Hook: 安全的应用准备检查，专门用于有复杂 hooks 的组件
 *
 * 这个 Hook 确保在所有其他 hooks 调用完成后再进行条件渲染检查
 *
 * 用法：
 * function MyComponent() {
 *   // 1. 先调用所有必要的 hooks
 *   const state = useMyState();
 *   const effect = useMyEffect();
 *
 *   // 2. 最后调用应用准备检查
 *   const shouldRender = useAppReadySafe();
 *
 *   // 3. 条件渲染
 *   if (!shouldRender) return <Loading />;
 *
 *   return <MyContent />;
 * }
 */
export function useAppReadySafe(): boolean {
  const { isReady, isInitialized } = useAppReady();

  // 返回是否应该渲染组件内容
  return isInitialized && isReady;
}

// HOC 功能已通过其他 hooks 实现，此处暂时移除以避免类型错误
