import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi, getHeaders } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import { StoreKey } from "../constant";
import Locale from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { chatInputStorage } from "./input";
import { storageHealthManager } from "../utils/storage-health";
import { uploadImage } from "../utils/chat";
import { systemMessageStorage } from "./system";
import { messageStorage, type ChatMessage } from "./message";
import { nanoid } from "nanoid";
import {
  createMessage,
  createEmptySession,
  createBranchSession,
  prepareMessagesForApi,
  generateSessionTitle,
  prepareSendMessages,
  insertMessage,
  calculateMoveIndex,
  validateSessionIndex,
  updateSessionStatsBasic,
  updateSessionStats,
  filterOutUserMessageByBatchId,
} from "../utils/session";
import { parseGroupMessageId } from "../utils/group";
import { calculateGroupStatus } from "../utils/group";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

// 全局 hydration 状态管理
let isHydrated = false;
const hydrationCallbacks: (() => void)[] = [];

// 添加状态锁机制，防止并发操作导致数据不一致
let isInitializing = false;
let initializationPromise: Promise<void> | null = null;

// 数据恢复状态管理（失败时强制刷新页面）
let isDataRestored = false;
let dataRestorationPromise: Promise<void> | null = null;
const DATA_RESTORATION_TIMEOUT = 10000; // 增加到10秒超时，给数据恢复更多时间

// 新增：应用准备就绪状态管理
let isAppReady = false;
let appReadyPromise: Promise<void> | null = null;
const appReadyCallbacks: (() => void)[] = [];

// 设置全局状态标记供其他模块使用
const setGlobalDataRestoredFlag = (restored: boolean) => {
  isDataRestored = restored;
  if (typeof window !== "undefined") {
    (window as any).__jchat_data_restored = restored;
  }
};

// 设置全局应用准备就绪标记
const setGlobalAppReadyFlag = (ready: boolean) => {
  isAppReady = ready;
  if (typeof window !== "undefined") {
    (window as any).__jchat_app_ready = ready;
  }
};

// 初始化全局标志
if (typeof window !== "undefined") {
  (window as any).__jchat_data_restored = false;
  (window as any).__jchat_app_ready = false;
}

// 强制页面刷新函数（当数据恢复失败时）
async function forceDataRestoration(): Promise<void> {
  if (isDataRestored) {
    debugLog("FORCE_RESTORE", "数据已恢复，跳过");
    return;
  }

  if (dataRestorationPromise) {
    debugLog("FORCE_RESTORE", "页面刷新检查正在进行中，等待");
    return dataRestorationPromise;
  }

  debugLog("FORCE_RESTORE", "开始检查数据恢复状态", {
    timestamp: Date.now(),
    isHydrated,
    hasRehydrated:
      typeof useChatStore !== "undefined" &&
      typeof useChatStore.persist === "function"
        ? (useChatStore.persist as any).hasHydrated?.()
        : false,
  });

  dataRestorationPromise = (async () => {
    try {
      // 等待存储准备就绪
      await waitForStorageReady();

      // 检查 persist 是否已经完成 rehydration
      if (
        typeof useChatStore !== "undefined" &&
        typeof useChatStore.persist === "function"
      ) {
        const hasRehydrated = (useChatStore.persist as any).hasHydrated?.();
        if (hasRehydrated) {
          debugLog("FORCE_RESTORE", "Persist 已完成 rehydration");
          isHydrated = true;
          setGlobalDataRestoredFlag(true);
          return;
        }
      }

      // 如果 persist 没有完成 rehydration，直接刷新页面
      debugLog("FORCE_RESTORE", "Persist 未完成 rehydration，即将刷新页面", {
        currentUrl:
          typeof window !== "undefined" ? window.location.href : "unknown",
        rehydrationFailed: true,
        timestamp: Date.now(),
      });

      debugLog("FORCE_RESTORE", "开始刷新页面");
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      debugLog("FORCE_RESTORE", "数据恢复检查失败，即将刷新页面", {
        error: error instanceof Error ? error.message : String(error),
      });

      debugLog("FORCE_RESTORE", "因错误刷新页面");
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } finally {
      dataRestorationPromise = null;
    }
  })();

  return dataRestorationPromise;
}

// 确保数据恢复的守护函数（失败时刷新页面）
function ensureDataRestoration(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isDataRestored) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      debugLog("ENSURE_RESTORE", "数据恢复超时，即将刷新页面");
      if (typeof window !== "undefined") {
        window.location.reload();
      }
      reject(new Error("数据恢复超时，已刷新页面"));
    }, DATA_RESTORATION_TIMEOUT);

    forceDataRestoration()
      .then(() => {
        clearTimeout(timeoutId);
        resolve();
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        debugLog("ENSURE_RESTORE", "数据恢复失败，即将刷新页面");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
        reject(error);
      });
  });
}

// 添加重试机制配置
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1秒
  storageTimeout: 5000, // 5秒超时
};

// 添加存储访问重试机制
async function retryStorageOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = RETRY_CONFIG.maxRetries,
  delay: number = RETRY_CONFIG.retryDelay,
): Promise<T> {
  // 数据未恢复时，直接拒绝存储操作
  if (!isDataRestored) {
    debugLog("STORAGE_RETRY", "❌ 数据未恢复，直接拒绝存储操作", {
      isDataRestored,
      isHydrated,
      timestamp: Date.now(),
      stackTrace: new Error().stack?.split("\n")[2]?.trim(),
    });
    throw new Error("数据未恢复，拒绝存储操作");
  }

  let lastError: Error | null = null;

  debugLog("STORAGE_RETRY", "开始存储操作", {
    maxRetries,
    delay,
    timeout: RETRY_CONFIG.storageTimeout,
    stackTrace: new Error().stack?.split("\n")[2]?.trim(), // 添加调用栈信息
  });

  for (let i = 0; i < maxRetries; i++) {
    try {
      debugLog("STORAGE_RETRY", `尝试存储操作 ${i + 1}/${maxRetries}`, {
        attempt: i + 1,
        isFirstAttempt: i === 0,
        previousError: lastError?.message,
      });

      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Storage operation timeout")),
            RETRY_CONFIG.storageTimeout,
          ),
        ),
      ]);

      debugLog("STORAGE_RETRY", "存储操作成功", {
        attempt: i + 1,
        hasResult: !!result,
        resultType: typeof result,
        resultPreview: Array.isArray(result)
          ? `Array(${result.length})`
          : result,
      });

      return result;
    } catch (error) {
      lastError = error as Error;
      debugLog("STORAGE_RETRY", "存储操作失败", {
        attempt: i + 1,
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        willRetry: i < maxRetries - 1,
        isTimeoutError:
          error instanceof Error && error.message.includes("timeout"),
        isStorageError:
          error instanceof Error &&
          (error.message.includes("QuotaExceededError") ||
            error.message.includes("InvalidStateError") ||
            error.message.includes("NotSupportedError")),
      });
      console.warn(`[Storage] 操作失败，重试 ${i + 1}/${maxRetries}:`, error);

      if (i < maxRetries - 1) {
        // 根据错误类型调整延迟时间
        const adjustedDelay =
          error instanceof Error && error.message.includes("timeout")
            ? delay * 2 // 超时错误增加延迟
            : delay;

        debugLog("STORAGE_RETRY", `等待 ${adjustedDelay}ms 后重试`);
        await new Promise((resolve) => setTimeout(resolve, adjustedDelay));
      }
    }
  }

  debugLog("STORAGE_RETRY", "存储操作最终失败", {
    totalRetries: maxRetries,
    finalError: lastError?.message || "未知错误",
    errorType: lastError?.constructor.name || "Unknown",
    stackTrace: lastError?.stack,
  });

  throw lastError;
}

// 添加存储准备就绪检查
async function waitForStorageReady(): Promise<void> {
  debugLog("STORAGE_READY", "开始存储准备就绪检查");

  // 检查 IndexedDB 是否可用
  if (typeof window === "undefined" || !window.indexedDB) {
    debugLog("STORAGE_READY", "IndexedDB 不可用", {
      hasWindow: typeof window !== "undefined",
      hasIndexedDB: typeof window !== "undefined" && !!window.indexedDB,
    });
    throw new Error("IndexedDB not available");
  }

  // 尝试打开一个测试数据库来验证 IndexedDB 是否正常工作
  const testDbName = "jchat_ready_test";
  let testDb: IDBDatabase | null = null;

  try {
    testDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(testDbName, 1);

      request.onerror = () => {
        debugLog("STORAGE_READY", "测试数据库打开失败", {
          error: request.error?.message,
        });
        reject(request.error);
      };

      request.onsuccess = () => {
        debugLog("STORAGE_READY", "测试数据库打开成功");
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        debugLog("STORAGE_READY", "测试数据库升级");
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("test")) {
          db.createObjectStore("test", { keyPath: "id" });
        }
      };
    });

    // 测试读写操作
    const testData = { id: "test", value: Date.now() };

    await new Promise<void>((resolve, reject) => {
      const transaction = testDb!.transaction(["test"], "readwrite");
      const store = transaction.objectStore("test");

      transaction.oncomplete = () => {
        debugLog("STORAGE_READY", "测试写入成功");
        resolve();
      };

      transaction.onerror = () => {
        debugLog("STORAGE_READY", "测试写入失败", {
          error: transaction.error?.message,
        });
        reject(transaction.error);
      };

      store.put(testData);
    });

    debugLog("STORAGE_READY", "存储准备就绪检查完成", {
      dbName: testDbName,
      testDataId: testData.id,
    });
  } catch (error) {
    debugLog("STORAGE_READY", "存储准备就绪检查失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    // 清理测试数据库
    if (testDb) {
      try {
        testDb.close();
        debugLog("STORAGE_READY", "关闭测试数据库");
      } catch (error) {
        debugLog("STORAGE_READY", "关闭测试数据库失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      indexedDB.deleteDatabase(testDbName);
      debugLog("STORAGE_READY", "清理测试数据库");
    } catch (error) {
      debugLog("STORAGE_READY", "清理测试数据库失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// 移除全局存储健康状态跟踪，现在总是尝试访问存储

export function isStoreHydrated(): boolean {
  return isHydrated;
}

export function isStoreDataRestored(): boolean {
  return isDataRestored;
}

export function isAppReadyState(): boolean {
  return isAppReady;
}

export function waitForHydration(): Promise<void> {
  if (isHydrated) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    hydrationCallbacks.push(resolve);
  });
}

export function waitForDataRestoration(): Promise<void> {
  if (isDataRestored) {
    return Promise.resolve();
  }

  return ensureDataRestoration();
}

export function waitForAppReady(): Promise<void> {
  if (isAppReady) {
    return Promise.resolve();
  }

  if (appReadyPromise) {
    return appReadyPromise;
  }

  return new Promise((resolve) => {
    appReadyCallbacks.push(resolve);
  });
}

// 新增：确保应用完全准备就绪的核心函数
async function ensureAppReady(): Promise<void> {
  if (isAppReady) {
    debugLog("APP_READY", "应用已准备就绪");
    return;
  }

  if (appReadyPromise) {
    debugLog("APP_READY", "等待现有的应用准备流程");
    return appReadyPromise;
  }

  debugLog("APP_READY", "开始应用准备流程");

  appReadyPromise = (async () => {
    try {
      // 1. 等待数据恢复完成
      debugLog("APP_READY", "步骤1: 等待数据恢复完成");
      await waitForDataRestoration();

      // 2. 等待 Zustand 水合完成
      debugLog("APP_READY", "步骤2: 等待 Zustand 水合完成");
      await waitForHydration();

      // 3. 验证存储系统健康状态
      debugLog("APP_READY", "步骤3: 验证存储系统健康状态");
      await waitForStorageReady();

      // 4. 验证数据一致性
      debugLog("APP_READY", "步骤4: 验证数据一致性");
      await validateDataIntegrity();

      // 5. 确保当前会话数据完整
      debugLog("APP_READY", "步骤5: 确保当前会话数据完整");
      await ensureCurrentSessionDataComplete();

      // 6. 标记应用准备就绪
      debugLog("APP_READY", "步骤6: 标记应用准备就绪");
      setGlobalAppReadyFlag(true);

      // 7. 触发所有回调
      debugLog("APP_READY", "步骤7: 触发准备就绪回调", {
        callbackCount: appReadyCallbacks.length,
      });

      appReadyCallbacks.forEach((callback, index) => {
        try {
          callback();
        } catch (error) {
          debugLog("APP_READY", `回调 ${index} 执行失败`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      appReadyCallbacks.length = 0;

      // 8. 清除应用准备超时定时器
      clearAppReadyTimeout();

      debugLog("APP_READY", "✅ 应用准备完成");
    } catch (error) {
      debugLog("APP_READY", "❌ 应用准备失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      appReadyPromise = null;
    }
  })();

  return appReadyPromise;
}

// 新增：验证数据一致性
async function validateDataIntegrity(): Promise<void> {
  debugLog("DATA_INTEGRITY", "开始数据一致性验证");

  const state = useChatStore.getState();

  // 验证会话数据完整性
  if (!Array.isArray(state.sessions)) {
    throw new Error("会话数据结构损坏：sessions 不是数组");
  }

  if (state.sessions.length === 0) {
    throw new Error("会话数据为空");
  }

  // 验证当前会话索引
  if (
    state.currentSessionIndex < 0 ||
    state.currentSessionIndex >= state.sessions.length
  ) {
    debugLog("DATA_INTEGRITY", "当前会话索引无效，尝试修复", {
      currentIndex: state.currentSessionIndex,
      sessionsLength: state.sessions.length,
    });

    // 自动修复索引
    const validIndex = Math.max(
      0,
      Math.min(state.currentSessionIndex, state.sessions.length - 1),
    );
    useChatStore.setState({ currentSessionIndex: validIndex });
  }

  // 验证组数据完整性
  if (!Array.isArray(state.groups)) {
    throw new Error("组数据结构损坏：groups 不是数组");
  }

  if (typeof state.groupSessions !== "object" || state.groupSessions === null) {
    throw new Error("组会话数据结构损坏：groupSessions 不是对象");
  }

  // 验证组索引
  if (
    state.groups.length > 0 &&
    (state.currentGroupIndex < 0 ||
      state.currentGroupIndex >= state.groups.length)
  ) {
    debugLog("DATA_INTEGRITY", "当前组索引无效，尝试修复", {
      currentIndex: state.currentGroupIndex,
      groupsLength: state.groups.length,
    });

    // 自动修复索引
    const validIndex = Math.max(
      0,
      Math.min(state.currentGroupIndex, state.groups.length - 1),
    );
    useChatStore.setState({ currentGroupIndex: validIndex });
  }

  debugLog("DATA_INTEGRITY", "✅ 数据一致性验证通过");
}

// 新增：确保当前会话数据完整
async function ensureCurrentSessionDataComplete(): Promise<void> {
  debugLog("CURRENT_SESSION_DATA", "开始验证当前会话数据完整性");

  const state = useChatStore.getState();
  const currentSession = state.currentSession();

  if (!currentSession) {
    debugLog("CURRENT_SESSION_DATA", "当前会话不存在，创建默认会话");
    await state.newSession();
    return;
  }

  // 检查消息是否需要加载
  const needsMessageLoad =
    currentSession.messageCount > 0 &&
    (!currentSession.messages || currentSession.messages.length === 0);

  if (needsMessageLoad) {
    debugLog("CURRENT_SESSION_DATA", "当前会话消息未加载，开始加载", {
      sessionId: currentSession.id,
      messageCount: currentSession.messageCount,
      isGroupSession: !!currentSession.groupId,
    });

    try {
      if (currentSession.groupId) {
        await state.loadGroupSessionMessages(currentSession.id);
      } else {
        await state.loadSessionMessages(state.currentSessionIndex);
      }

      // 验证加载结果
      const updatedSession = useChatStore.getState().currentSession();
      const loadSuccess =
        updatedSession?.messages && updatedSession.messages.length > 0;

      if (!loadSuccess) {
        debugLog("CURRENT_SESSION_DATA", "消息加载失败，但继续启动");
        // 不抛出错误，允许应用继续启动
      } else {
        debugLog("CURRENT_SESSION_DATA", "✅ 消息加载成功", {
          sessionId: updatedSession.id,
          loadedMessages: updatedSession.messages.length,
        });
      }
    } catch (error) {
      debugLog("CURRENT_SESSION_DATA", "消息加载失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      // 不抛出错误，允许应用继续启动
    }
  } else {
    debugLog("CURRENT_SESSION_DATA", "当前会话数据完整，无需加载", {
      sessionId: currentSession.id,
      messageCount: currentSession.messageCount,
      messagesLength: currentSession.messages?.length || 0,
    });
  }

  debugLog("CURRENT_SESSION_DATA", "✅ 当前会话数据验证完成");
}

// 添加调试日志函数
const debugLog = (category: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const logData = data
    ? typeof data === "object"
      ? JSON.stringify(data, null, 2)
      : data
    : "";
  console.log(
    `[ChatStore-${category}] ${timestamp} - ${message}${logData ? "\n" + logData : ""}`,
  );
};

// 添加启动状态跟踪
let startupState = {
  isInitialized: false,
  initStartTime: 0,
  initEndTime: 0,
  hydrationCompleted: false,
  firstDataLoad: false,
  lastError: null as Error | null,
};

// 重置启动状态
const resetStartupState = () => {
  startupState = {
    isInitialized: false,
    initStartTime: Date.now(),
    initEndTime: 0,
    hydrationCompleted: false,
    firstDataLoad: false,
    lastError: null,
  };
  debugLog("STARTUP", "重置启动状态", startupState);
};

// 改进的安全状态初始化函数
async function safeInitializeStore(): Promise<void> {
  debugLog("INIT", "开始安全初始化存储", {
    isInitializing,
    hasPromise: !!initializationPromise,
    startupState,
    currentTime: Date.now(),
    documentReadyState:
      typeof document !== "undefined" ? document.readyState : "unknown",
  });

  // 防止重复初始化
  if (isInitializing) {
    debugLog("INIT", "已经在初始化中，返回现有 Promise");
    return initializationPromise || Promise.resolve();
  }

  isInitializing = true;
  initializationPromise = (async () => {
    try {
      // 首先等待存储准备就绪
      debugLog("INIT", "等待存储准备就绪");
      await waitForStorageReady();

      // 添加额外的延迟以确保浏览器完全准备好
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 详细的状态获取调试
      const state = useChatStore.getState();
      debugLog("INIT", "获取当前状态", {
        sessionsCount: state.sessions.length,
        groupsCount: state.groups.length,
        currentSessionIndex: state.currentSessionIndex,
        currentGroupIndex: state.currentGroupIndex,
        chatListView: state.chatListView,
        hasDefaultSession: state.sessions.length > 0,
        defaultSessionId: state.sessions[0]?.id,
        defaultSessionTitle: state.sessions[0]?.title,
        defaultSessionMessageCount: state.sessions[0]?.messageCount,
        defaultSessionMessagesLength: state.sessions[0]?.messages?.length,
        stateIntegrity: {
          sessionsIsArray: Array.isArray(state.sessions),
          groupsIsArray: Array.isArray(state.groups),
          groupSessionsIsObject: typeof state.groupSessions === "object",
          hasValidCurrentSessionIndex:
            state.currentSessionIndex >= 0 &&
            state.currentSessionIndex < state.sessions.length,
          hasValidCurrentGroupIndex:
            state.currentGroupIndex >= 0 &&
            state.currentGroupIndex < state.groups.length,
        },
      });

      // 获取当前会话的详细信息
      const session = state.currentSession();
      // debugLog("INIT", "获取当前会话详情", {
      //   sessionExists: !!session,
      //   sessionId: session?.id,
      //   sessionTitle: session?.title,
      //   sessionGroupId: session?.groupId,
      //   sessionMessageCount: session?.messageCount,
      //   sessionMessagesLength: session?.messages?.length,
      //   sessionStatus: session?.status,
      //   sessionModel: session?.model,
      //   sessionLastUpdate: session?.lastUpdate,
      //   sessionMessagesIsArray: Array.isArray(session?.messages),
      //   sessionHasValidMessages:
      //     session?.messages && Array.isArray(session.messages),
      // });

      // 检查是否需要加载消息
      const needsMessageLoad =
        session &&
        (!session.messages ||
          session.messages.length === 0 ||
          (session.messageCount > 0 && session.messages.length === 0));

      debugLog("INIT", "消息加载需求分析", {
        needsMessageLoad,
        sessionExists: !!session,
        hasMessages: !!(session?.messages && session.messages.length > 0),
        messageCount: session?.messageCount || 0,
        messagesLength: session?.messages?.length || 0,
        isFirstLoad: !startupState.firstDataLoad,
        loadingConditions: {
          noMessages: !session?.messages,
          emptyMessages: session?.messages?.length === 0,
          messageCountMismatch:
            session?.messageCount > 0 && session?.messages?.length === 0,
        },
      });

      if (session && needsMessageLoad) {
        try {
          debugLog("INIT", "开始加载会话消息", {
            sessionId: session.id,
            groupId: session.groupId,
            loadType: session.groupId ? "group" : "normal",
            retryAttempts: RETRY_CONFIG.maxRetries,
          });

          // 使用重试机制加载消息
          if (session.groupId) {
            debugLog("INIT", "加载组内会话消息", {
              sessionId: session.id,
              groupId: session.groupId,
            });
            await retryStorageOperation(() =>
              state.loadGroupSessionMessages(session.id),
            );
          } else {
            debugLog("INIT", "加载普通会话消息", {
              sessionIndex: state.currentSessionIndex,
              sessionId: session.id,
            });
            await retryStorageOperation(() =>
              state.loadSessionMessages(state.currentSessionIndex),
            );
          }

          // 验证消息是否成功加载
          const updatedState = useChatStore.getState();
          const updatedSession = updatedState.currentSession();

          debugLog("INIT", "验证消息加载结果", {
            sessionId: updatedSession?.id,
            originalMessageCount: session.messageCount,
            loadedMessagesCount: updatedSession?.messages?.length || 0,
            messagesLoaded: !!(
              updatedSession?.messages && updatedSession.messages.length > 0
            ),
            loadSuccess:
              updatedSession?.messages?.length === session.messageCount ||
              (session.messageCount === 0 &&
                updatedSession?.messages?.length === 0),
            messageIntegrity: {
              messagesIsArray: Array.isArray(updatedSession?.messages),
              hasValidLength: (updatedSession?.messages?.length || 0) >= 0,
              firstMessagePreview: updatedSession?.messages?.[0]
                ? {
                    id: updatedSession.messages[0].id,
                    role: updatedSession.messages[0].role,
                    hasContent: !!updatedSession.messages[0].content,
                  }
                : null,
            },
          });

          // 标记首次数据加载完成
          if (!startupState.firstDataLoad) {
            startupState.firstDataLoad = true;
            debugLog("INIT", "首次数据加载完成", {
              sessionId: updatedSession?.id,
              loadedMessages: updatedSession?.messages?.length || 0,
              elapsedTime: Date.now() - startupState.initStartTime,
            });
          }

          // 检查数据完整性
          const finalSession =
            updatedState.sessions[updatedState.currentSessionIndex] ||
            updatedState.groupSessions[session.id];

          if (
            finalSession &&
            finalSession.messageCount > 0 &&
            (!finalSession.messages || finalSession.messages.length === 0)
          ) {
            debugLog("INIT", "⚠️ 检测到数据不一致，尝试恢复数据", {
              sessionId: finalSession.id,
              expectedMessageCount: finalSession.messageCount,
              actualMessagesLength: finalSession.messages?.length || 0,
              sessionType: finalSession.groupId ? "group" : "normal",
              possibleCauses: [
                "存储读取延迟",
                "IndexedDB 未完全准备",
                "数据损坏",
                "竞态条件",
              ],
            });

            // 尝试从备用存储恢复
            try {
              // 添加额外延迟以等待存储稳定
              await new Promise((resolve) => setTimeout(resolve, 200));

              if (finalSession.groupId) {
                await retryStorageOperation(() =>
                  state.loadGroupSessionMessages(finalSession.id),
                );
              } else {
                await retryStorageOperation(() =>
                  state.loadSessionMessages(state.currentSessionIndex),
                );
              }

              // 再次验证恢复结果
              const recoveredState = useChatStore.getState();
              const recoveredSession = recoveredState.currentSession();

              debugLog("INIT", "数据恢复结果", {
                sessionId: recoveredSession?.id,
                recoveredMessagesCount: recoveredSession?.messages?.length || 0,
                recoverySuccess: !!(
                  recoveredSession?.messages &&
                  recoveredSession.messages.length > 0
                ),
                finalMessageCount: recoveredSession?.messageCount || 0,
                dataConsistency: {
                  messageCountMatch:
                    recoveredSession?.messages?.length ===
                    recoveredSession?.messageCount,
                  hasValidData:
                    recoveredSession?.messages &&
                    recoveredSession.messages.length > 0,
                },
              });

              if (
                recoveredSession?.messages &&
                recoveredSession.messages.length > 0
              ) {
                debugLog("INIT", "✅ 数据恢复成功");
              } else {
                debugLog("INIT", "❌ 数据恢复失败，数据可能已丢失");
              }
            } catch (recoveryError) {
              debugLog("INIT", "❌ 数据恢复失败", {
                error:
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
                errorType:
                  recoveryError instanceof Error
                    ? recoveryError.constructor.name
                    : typeof recoveryError,
              });
              console.error("[ChatStore] 数据恢复失败:", recoveryError);
              startupState.lastError =
                recoveryError instanceof Error
                  ? recoveryError
                  : new Error(String(recoveryError));
            }
          } else {
            debugLog("INIT", "✅ 数据一致性检查通过", {
              sessionId: finalSession?.id,
              messageCount: finalSession?.messageCount,
              messagesLength: finalSession?.messages?.length,
            });
          }
        } catch (error) {
          debugLog("INIT", "❌ 加载会话消息失败", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            isStorageError:
              error instanceof Error &&
              (error.message.includes("QuotaExceededError") ||
                error.message.includes("InvalidStateError") ||
                error.message.includes("NotSupportedError") ||
                error.message.includes("timeout")),
          });
          console.error("[ChatStore] 加载会话消息失败:", error);
          startupState.lastError =
            error instanceof Error ? error : new Error(String(error));
        }
      } else {
        debugLog("INIT", "跳过消息加载", {
          reason: !session ? "当前会话不存在" : "消息已加载或无需加载",
          sessionId: session?.id,
          hasMessages: !!(session?.messages && session.messages.length > 0),
          messageCount: session?.messageCount || 0,
        });
      }

      // 存储健康检查（异步，不阻塞主流程）
      setTimeout(async () => {
        try {
          debugLog("INIT", "开始存储健康检查");
          const isHealthy = await storageHealthManager.checkHealth();
          debugLog("INIT", "存储健康检查结果", {
            isHealthy,
            timestamp: Date.now(),
          });

          if (!isHealthy) {
            console.warn("[ChatStore] 存储系统异常，但应用继续正常运行");
          }
        } catch (error) {
          debugLog("INIT", "存储健康检查失败", {
            error: error instanceof Error ? error.message : String(error),
          });
          console.warn("[ChatStore] 存储健康检查失败:", error);
        }
      }, 100);

      // 标记初始化完成
      startupState.isInitialized = true;
      startupState.initEndTime = Date.now();

      debugLog("INIT", "✅ 初始化完成", {
        totalTime: startupState.initEndTime - startupState.initStartTime,
        firstDataLoad: startupState.firstDataLoad,
        hasError: !!startupState.lastError,
        finalState: {
          currentSessionId: useChatStore.getState().currentSession()?.id,
          messagesLoaded: !!useChatStore.getState().currentSession()?.messages
            ?.length,
          messageCount: useChatStore.getState().currentSession()?.messageCount,
          messagesLength: useChatStore.getState().currentSession()?.messages
            ?.length,
        },
      });
    } catch (error) {
      debugLog("INIT", "❌ 初始化失败", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
        isStorageError:
          error instanceof Error &&
          (error.message.includes("QuotaExceededError") ||
            error.message.includes("InvalidStateError") ||
            error.message.includes("NotSupportedError") ||
            error.message.includes("timeout")),
      });
      console.error("[ChatStore] 初始化失败:", error);
      startupState.lastError =
        error instanceof Error ? error : new Error(String(error));
    } finally {
      isInitializing = false;
      initializationPromise = null;
      debugLog("INIT", "初始化流程结束", {
        isInitialized: startupState.isInitialized,
        hasError: !!startupState.lastError,
        elapsedTime: Date.now() - startupState.initStartTime,
      });
    }
  })();

  return initializationPromise;
}

export interface ChatSession {
  id: string;
  title: string;
  sourceName?: string; // 表示生成该会话的源文件名，可选
  model: string; // 当前会话选择的模型
  messageCount: number; // 消息数量
  status: "normal" | "error" | "pending"; // 会话状态：正常、错误、用户消息结尾
  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  groupId: string | null;
  lastUpdate: number;
  messages: ChatMessage[];
}

export interface ChatGroup {
  id: string;
  title: string;
  sessionIds: string[];
  messageCount: number;
  status: "normal" | "error" | "pending";
  pendingCount: number;
  errorCount: number;
  currentSessionIndex: number;
}

export interface GroupSession {
  [sessionId: string]: ChatSession;
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()] as ChatSession[],
  groups: [] as ChatGroup[], // 组列表
  groupSessions: {} as GroupSession, // 组内会话列表
  currentSessionIndex: 0,
  currentGroupIndex: 0,
  chatListView: "sessions" as "sessions" | "groups",
  chatListGroupView: "groups" as "groups" | "group-sessions",
  models: [] as string[],
  accessCode: "",
  batchApplyMode: false, // 批量应用模式
  activeBatchRequests: 0, // 活跃的批量请求计数器
  mobileViewState: "sidebar" as "sidebar" | "chat" | "settings", // 移动端界面状态
};

export const DEFAULT_TITLE = Locale.Session.Title.Default;

// 调试默认状态
debugLog("DEFAULT_STATE", "默认状态初始化", {
  sessionsCount: DEFAULT_CHAT_STATE.sessions.length,
  defaultSessionId: DEFAULT_CHAT_STATE.sessions[0]?.id,
  defaultSessionTitle: DEFAULT_CHAT_STATE.sessions[0]?.title,
  defaultSessionMessageCount: DEFAULT_CHAT_STATE.sessions[0]?.messageCount,
  groupsCount: DEFAULT_CHAT_STATE.groups.length,
  currentSessionIndex: DEFAULT_CHAT_STATE.currentSessionIndex,
  currentGroupIndex: DEFAULT_CHAT_STATE.currentGroupIndex,
  chatListView: DEFAULT_CHAT_STATE.chatListView,
});

debugLog("STORE_INIT", "开始创建 ChatStore", {
  timestamp: Date.now(),
  hasWindow: typeof window !== "undefined",
  hasIndexedDB: typeof window !== "undefined" && !!window.indexedDB,
  hasDocument: typeof document !== "undefined",
  documentReadyState:
    typeof document !== "undefined" ? document.readyState : "unknown",
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
});

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    const methods = {
      // 新增：渲染优化相关状态管理
      batchApplyMode: false, // 批量应用模式标志
      activeBatchRequests: 0, // 活跃的批量请求计数器

      // 新增：设置批量应用模式
      setBatchApplyMode(enabled: boolean): void {
        set({ batchApplyMode: enabled });

        // 启用批量模式时重置计数器
        if (enabled) {
          set({ activeBatchRequests: 0 });
        }
      },

      // 移动端界面状态管理
      setMobileViewState(state: "sidebar" | "chat" | "settings"): void {
        set({ mobileViewState: state });
      },

      showSidebarOnMobile(): void {
        set({ mobileViewState: "sidebar" });
      },

      showChatOnMobile(): void {
        set({ mobileViewState: "chat" });
      },

      showSettingsOnMobile(): void {
        set({ mobileViewState: "settings" });
      },

      // 新增：增加活跃批量请求计数
      incrementBatchRequest(): void {
        const state = get();
        if (state.batchApplyMode) {
          const newCount = state.activeBatchRequests + 1;
          set({ activeBatchRequests: newCount });
        }
      },

      // 新增：减少活跃批量请求计数，当计数为0时自动退出批量模式
      decrementBatchRequest(): void {
        const state = get();
        if (state.batchApplyMode && state.activeBatchRequests > 0) {
          const newCount = state.activeBatchRequests - 1;
          set({ activeBatchRequests: newCount });

          // 当所有请求完成时自动退出批量模式
          if (newCount === 0) {
            state.setBatchApplyMode(false);
            showToast("🎉 批量应用全部完成！");
          }
        }
      },

      // 新增：判断会话是否为当前可见会话
      isCurrentVisibleSession(sessionId: string): boolean {
        const state = get();
        const currentSession = state.currentSession();
        return currentSession.id === sessionId;
      },

      // 新增：智能更新会话状态（只有当前会话触发UI重新渲染）
      smartUpdateSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
        forceRender: boolean = false,
      ): void {
        const state = get();
        const isVisible = state.isCurrentVisibleSession(session.id);

        if (session.groupId) {
          state.updateGroupSession(session, (sessionToUpdate) => {
            updater(sessionToUpdate);

            // 极简渲染策略：只有可见会话或强制渲染时才触发UI更新
            const shouldRender = isVisible || forceRender;

            if (shouldRender) {
              sessionToUpdate.messages = sessionToUpdate.messages.concat();
            }
            updateSessionStatsBasic(sessionToUpdate);
          });
        } else {
          state.updateSession(session, (sessionToUpdate) => {
            updater(sessionToUpdate);

            // 极简渲染策略：只有可见会话或强制渲染时才触发UI更新
            const shouldRender = isVisible || forceRender;

            if (shouldRender) {
              sessionToUpdate.messages = sessionToUpdate.messages.concat();
            }
            updateSessionStatsBasic(sessionToUpdate);
          });
        }
      },

      // 新增：加载指定会话的消息（改进版）
      async loadSessionMessages(sessionIndex: number): Promise<void> {
        const session = get().sessions[sessionIndex];
        if (!session) {
          debugLog("LOAD", "会话不存在", {
            sessionIndex,
            totalSessions: get().sessions.length,
            requestedIndex: sessionIndex,
          });
          console.error(
            "[ChatStore] Session not found at index:",
            sessionIndex,
          );
          return;
        }

        debugLog("LOAD", "开始加载会话消息", {
          sessionIndex,
          sessionId: session.id,
          title: session.title,
          messageCount: session.messageCount,
          currentMessagesLength: session.messages?.length || 0,
          sessionStatus: session.status,
          sessionModel: session.model,
          hasMessages: !!(session.messages && session.messages.length > 0),
          isGroupSession: !!session.groupId,
          loadingReason:
            session.messages?.length === 0 ? "空消息数组" : "消息未加载",
        });

        try {
          const messages = await retryStorageOperation(
            () => {
              debugLog("LOAD", "执行存储操作", {
                sessionId: session.id,
                operation: "messageStorage.get",
                timestamp: Date.now(),
              });
              return messageStorage.get(session.id);
            },
            3, // 增加重试次数
            1500, // 增加重试延迟
          );

          debugLog("LOAD", "消息加载结果", {
            sessionId: session.id,
            loadedMessagesCount: messages?.length || 0,
            hasMessages: !!messages,
            messagesType: typeof messages,
            isArray: Array.isArray(messages),
            firstMessagePreview: messages?.[0]
              ? {
                  id: messages[0].id,
                  role: messages[0].role,
                  hasContent: !!messages[0].content,
                  contentType: typeof messages[0].content,
                  contentLength:
                    typeof messages[0].content === "string"
                      ? messages[0].content.length
                      : 0,
                }
              : null,
            storageLoadSuccess: !!messages,
          });

          set((state) => {
            const newSessions = [...state.sessions];
            const targetSession = { ...newSessions[sessionIndex] };

            if (messages && Array.isArray(messages)) {
              targetSession.messages = messages;
              debugLog("LOAD", "设置加载的消息", {
                sessionId: session.id,
                messagesCount: messages.length,
                messageIds: messages.map((m) => m.id),
                messageRoles: messages.map((m) => m.role),
                totalMessageLength: messages.reduce(
                  (sum, m) =>
                    sum +
                    (typeof m.content === "string" ? m.content.length : 0),
                  0,
                ),
              });
            } else if (targetSession.messageCount > 0) {
              // 如果 messageCount > 0 但无法从 storage 加载消息，
              // 这表示数据可能已损坏或丢失。
              // 创建一条错误消息以通知用户。
              debugLog("LOAD", "检测到数据丢失", {
                sessionId: session.id,
                expectedMessageCount: targetSession.messageCount,
                actualMessagesLoaded: 0,
                loadedData: messages,
                dataType: typeof messages,
                possibleCauses: [
                  "IndexedDB 数据损坏",
                  "存储权限问题",
                  "浏览器存储限制",
                  "数据迁移问题",
                ],
              });
              console.warn(
                `[ChatStore] Messages for session ${session.id} not found, but messageCount is ${targetSession.messageCount}. Indicating data loss.`,
              );
              targetSession.messages = [
                createMessage({
                  role: "system",
                  content: Locale.Store.MessageNotFound,
                  isError: true,
                }),
              ];
            } else {
              targetSession.messages = [];
              debugLog("LOAD", "设置空消息数组", {
                sessionId: session.id,
                reason: "messageCount为0",
                originalMessageCount: targetSession.messageCount,
              });
            }

            newSessions[sessionIndex] = targetSession;
            return { sessions: newSessions };
          });

          debugLog("LOAD", "会话消息加载完成", {
            sessionIndex,
            sessionId: session.id,
            finalMessagesCount:
              get().sessions[sessionIndex].messages?.length || 0,
            finalMessageCount: get().sessions[sessionIndex].messageCount,
            loadSuccess: true,
          });
        } catch (error) {
          debugLog("LOAD", "加载会话消息失败", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : undefined,
            isStorageError:
              error instanceof Error &&
              (error.message.includes("QuotaExceededError") ||
                error.message.includes("InvalidStateError") ||
                error.message.includes("NotSupportedError") ||
                error.message.includes("timeout")),
          });
          console.error(
            `[ChatStore] Failed to load messages for session ${session.id}:`,
            error,
          );
          // 即使加载失败，也要设置一个错误消息
          set((state) => {
            const newSessions = [...state.sessions];
            const targetSession = { ...newSessions[sessionIndex] };
            targetSession.messages = [
              createMessage({
                role: "system",
                content: Locale.Store.MessageLoadFailed,
                isError: true,
              }),
            ];
            newSessions[sessionIndex] = targetSession;
            return { sessions: newSessions };
          });
        }
      },

      // 新增：保存会话消息到独立存储
      async saveSessionMessages(
        session: ChatSession,
        force: boolean = false,
      ): Promise<void> {
        // 数据未恢复时，禁止数据持久化
        if (!isDataRestored) {
          debugLog("SAVE_SESSION_MESSAGES", "❌ 数据未恢复，禁止消息持久化", {
            sessionId: session.id,
            isDataRestored,
            force,
            timestamp: Date.now(),
          });
          return;
        }

        try {
          let messagesToSave = session.messages;

          // 对于组内会话，需要从 groupSessions 中获取最新的消息
          if (session.groupId) {
            const groupSession = get().groupSessions[session.id];
            if (groupSession && groupSession.messages) {
              messagesToSave = groupSession.messages;
            }
          }

          const success = await messageStorage.save(
            session.id,
            messagesToSave,
            force,
          );
        } catch (error) {
          console.error(
            `[ChatStore] Failed to save messages for session ${session.id}`,
            error,
          );
        }
      },

      // 优化：会话切换时的清理
      selectSession(index: number) {
        // 严格要求数据恢复完成
        if (!isDataRestored) {
          debugLog("SELECT_SESSION", "❌ 数据未恢复，禁止切换会话", {
            isDataRestored,
            isHydrated,
            targetIndex: index,
            timestamp: Date.now(),
          });
          return;
        }

        const validIndex = validateSessionIndex(index, get().sessions.length);
        if (validIndex !== index) {
          index = validIndex;
        }

        set((state) => ({
          currentSessionIndex: index,
          chatListView: "sessions",
        }));

        // 异步加载消息，避免阻塞UI切换
        setTimeout(() => {
          get().loadSessionMessages(index);
          // 强制渲染目标会话以确保显示最新内容
          const targetSession = get().sessions[index];
          if (targetSession) {
            get().smartUpdateSession(targetSession, () => {}, true);
          }
        }, 0);
      },

      // 优化：组会话切换时的清理
      selectGroupSession(index: number, switchToChatView: boolean = true) {
        // 严格要求数据恢复完成
        if (!isDataRestored) {
          debugLog("SELECT_GROUP_SESSION", "❌ 数据未恢复，禁止切换组会话", {
            isDataRestored,
            isHydrated,
            targetIndex: index,
            timestamp: Date.now(),
          });
          return;
        }

        const state = get();
        const currentGroup = state.groups[state.currentGroupIndex];
        if (!currentGroup || index >= currentGroup.sessionIds.length) {
          return;
        }

        // 更新当前组的会话索引
        set((state) => {
          const newGroups = [...state.groups];
          newGroups[state.currentGroupIndex] = {
            ...newGroups[state.currentGroupIndex],
            currentSessionIndex: index,
          };
          return {
            groups: newGroups,
            chatListView: switchToChatView ? "groups" : state.chatListView,
            chatListGroupView: "group-sessions",
          };
        });

        const sessionId = currentGroup.sessionIds[index];

        // 异步加载消息，避免阻塞UI切换
        setTimeout(() => {
          get().loadGroupSessionMessages(sessionId);
          // 强制渲染目标会话以确保显示最新内容
          const targetSession = get().groupSessions[sessionId];
          if (targetSession) {
            get().smartUpdateSession(targetSession, () => {}, true);
          }
        }, 0);
      },

      moveSession(from: number, to: number) {
        const oldIndex = get().currentSessionIndex;

        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // calculate new index using utility function
          const newIndex = calculateMoveIndex(from, to, oldIndex);

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });

        // **修复：如果当前会话索引改变了，加载新当前会话的消息**
        const newIndex = calculateMoveIndex(from, to, oldIndex);
        if (newIndex !== oldIndex) {
          get().loadSessionMessages(newIndex);
        }
      },

      // 移动组的位置
      moveGroup(from: number, to: number) {
        const oldIndex = get().currentGroupIndex;

        set((state) => {
          const { groups, currentGroupIndex: oldIndex } = state;

          // move the group
          const newGroups = [...groups];
          const group = newGroups[from];
          newGroups.splice(from, 1);
          newGroups.splice(to, 0, group);

          // calculate new index using utility function
          const newIndex = calculateMoveIndex(from, to, oldIndex);

          return {
            currentGroupIndex: newIndex,
            groups: newGroups,
          };
        });
      },

      async newSession() {
        const session = createEmptySession();

        // 总是尝试保存消息，不依赖存储健康状态
        try {
          await get().saveSessionMessages(session);
        } catch (error) {
          console.error("[ChatStore] 保存会话消息失败:", error);
          // 即使保存失败，也继续创建会话
        }

        set((state) => {
          return {
            currentSessionIndex: 0,
            sessions: [session].concat(state.sessions),
          };
        });

        // 总是尝试加载消息，不依赖存储健康状态
        try {
          await get().loadSessionMessages(0);
        } catch (error) {
          console.error("[ChatStore] 加载会话消息失败:", error);
          // 即使加载失败，也不影响会话创建
        }
      },

      async newGroup(group: ChatGroup) {
        const { groups, groupSessions } = get();

        // 创建组内第一个会话
        const firstSession = createEmptySession();
        firstSession.groupId = group.id;
        firstSession.title = group.title;

        // 保存会话消息
        await get().saveSessionMessages(firstSession);

        // 更新组和组内会话
        set((state) => {
          const updatedGroup = {
            ...group,
            sessionIds: [firstSession.id],
            currentSessionIndex: 0,
            title: firstSession.title,
            messageCount: firstSession.messageCount,
            errorCount: 0,
            pendingCount: 0,
          };

          // 确保组状态与计数保持一致
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          return {
            groups: [updatedGroup, ...state.groups],
            groupSessions: {
              ...state.groupSessions,
              [firstSession.id]: firstSession,
            },
            currentGroupIndex: 0,
          };
        });
      },

      // 新建组内会话
      async newGroupSession() {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          console.warn("[ChatStore] No current group found");
          return;
        }

        // 创建新的组内会话
        const newSession = createEmptySession();
        newSession.groupId = currentGroup.id;
        newSession.title = Locale.Session.Title.DefaultGroup;

        // 保存会话消息
        await get().saveSessionMessages(newSession);

        // 更新组和组内会话
        set((state) => {
          const updatedGroup = {
            ...currentGroup,
            sessionIds: [...currentGroup.sessionIds, newSession.id],
            currentSessionIndex: currentGroup.sessionIds.length,
            title:
              currentGroup.sessionIds.length === 0
                ? newSession.title
                : currentGroup.title,
            messageCount: currentGroup.messageCount + newSession.messageCount,
          };

          // 确保组状态与计数保持一致
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          const newGroups = [...state.groups];
          newGroups[currentGroupIndex] = updatedGroup;

          return {
            groups: newGroups,
            groupSessions: {
              ...state.groupSessions,
              [newSession.id]: newSession,
            },
          };
        });

        // 确保新会话的消息正确加载
        await get().loadGroupSessionMessages(newSession.id);
      },

      // 设置聊天列表模式
      setchatListView(mode: "sessions" | "groups") {
        set({ chatListView: mode });

        // 切换模式后，确保当前会话的消息已加载
        setTimeout(() => {
          const session = get().currentSession();
          if (session && (!session.messages || session.messages.length === 0)) {
            if (session.groupId) {
              // 组内会话：加载组内会话消息
              get().loadGroupSessionMessages(session.id);
            } else {
              // 普通会话：加载普通会话消息
              get().loadSessionMessages(get().currentSessionIndex);
            }
          }
        }, 0);
      },

      // 设置组内视图模式
      setchatListGroupView(mode: "groups" | "group-sessions") {
        set({ chatListGroupView: mode });

        // 切换组内视图后，确保当前会话的消息已加载
        setTimeout(() => {
          const session = get().currentSession();
          if (
            session &&
            session.groupId &&
            (!session.messages || session.messages.length === 0)
          ) {
            get().loadGroupSessionMessages(session.id);
          }
        }, 0);
      },

      // 选择指定的组
      selectGroup(index: number) {
        const { groups, currentGroupIndex, groupSessions } = get();
        const targetGroup = groups[index];

        if (!targetGroup || targetGroup.sessionIds.length === 0) return;

        // 判断是否是第一次点击该组（当前组索引不是这个组）
        if (currentGroupIndex !== index) {
          // 第一次点击：切换到该组并加载第一个会话，但不切换到组内会话视图
          const firstSessionId = targetGroup.sessionIds[0];
          const firstSession = groupSessions[firstSessionId];

          if (firstSession) {
            // 切换到该组，保持在组列表视图
            set({
              currentGroupIndex: index,
              chatListGroupView: "groups", // 确保保持在组列表视图
            });

            // 加载第一个会话的消息（如果还没加载）
            if (!firstSession.messages || firstSession.messages.length === 0) {
              get().loadGroupSessionMessages(firstSessionId);
            }
          }
        } else {
          // 第二次点击：切换到组内会话视图
          set({
            chatListGroupView: "group-sessions",
          });
        }
      },

      // 新增：加载组内会话的消息
      async loadGroupSessionMessages(sessionId: string): Promise<void> {
        if (typeof window === "undefined") {
          debugLog("LOAD_GROUP", "非客户端环境，跳过加载", { sessionId });
          return;
        }

        const session = get().groupSessions[sessionId];
        if (!session) {
          debugLog("LOAD_GROUP", "组内会话不存在", {
            sessionId,
            availableSessionIds: Object.keys(get().groupSessions),
            totalGroupSessions: Object.keys(get().groupSessions).length,
          });
          console.warn(`[ChatStore] Group session ${sessionId} not found`);
          return;
        }

        debugLog("LOAD_GROUP", "开始加载组内会话消息", {
          sessionId,
          title: session.title,
          groupId: session.groupId,
          messageCount: session.messageCount,
          currentMessagesLength: session.messages?.length || 0,
          sessionStatus: session.status,
          sessionModel: session.model,
          hasMessages: !!(session.messages && session.messages.length > 0),
          lastUpdate: session.lastUpdate,
          loadingReason:
            session.messages?.length === 0 ? "空消息数组" : "消息未加载",
        });

        // 如果消息已经加载（非空），则不重复加载
        if (session.messages && session.messages.length > 0) {
          debugLog("LOAD_GROUP", "消息已加载，跳过", {
            sessionId,
            messagesLength: session.messages.length,
            messageIds: session.messages.map((m) => m.id),
            firstMessageRole: session.messages[0]?.role,
            lastMessageRole:
              session.messages[session.messages.length - 1]?.role,
          });
          return;
        }

        try {
          // 使用重试机制从 messageStorage 加载消息
          const messages = await retryStorageOperation(
            () => {
              debugLog("LOAD_GROUP", "执行存储操作", {
                sessionId,
                operation: "messageStorage.get",
                timestamp: Date.now(),
              });
              return messageStorage.get(sessionId);
            },
            3,
            1500,
          ); // 增加重试次数和延迟

          debugLog("LOAD_GROUP", "消息加载结果", {
            sessionId,
            loadedMessagesCount: messages?.length || 0,
            hasMessages: !!messages,
            messagesType: typeof messages,
            isArray: Array.isArray(messages),
            firstMessagePreview: messages?.[0]
              ? {
                  id: messages[0].id,
                  role: messages[0].role,
                  hasContent: !!messages[0].content,
                  contentType: typeof messages[0].content,
                  contentLength:
                    typeof messages[0].content === "string"
                      ? messages[0].content.length
                      : 0,
                }
              : null,
            lastMessagePreview:
              messages && messages.length > 1
                ? {
                    id: messages[messages.length - 1].id,
                    role: messages[messages.length - 1].role,
                    hasContent: !!messages[messages.length - 1].content,
                  }
                : null,
            storageLoadSuccess: !!messages,
          });

          // 验证加载的数据
          if (messages && Array.isArray(messages) && messages.length > 0) {
            debugLog("LOAD_GROUP", "设置加载的消息", {
              sessionId,
              messagesCount: messages.length,
              messageIds: messages.map((m) => m.id),
              messageRoles: messages.map((m) => m.role),
              totalMessageLength: messages.reduce(
                (sum, m) =>
                  sum + (typeof m.content === "string" ? m.content.length : 0),
                0,
              ),
            });

            set((state) => {
              const updatedSession = {
                ...session,
                messages: messages,
                messageCount: messages.length,
              };

              // 如果是第一个会话，同时更新组的 messageCount
              let newGroups = state.groups;
              if (session.groupId) {
                const groupIndex = state.groups.findIndex(
                  (g) => g.id === session.groupId,
                );
                if (groupIndex !== -1) {
                  const group = state.groups[groupIndex];
                  const firstSessionId = group.sessionIds[0];
                  if (firstSessionId === sessionId) {
                    debugLog("LOAD_GROUP", "更新组的消息计数", {
                      sessionId,
                      groupId: session.groupId,
                      messagesCount: messages.length,
                    });
                    newGroups = [...state.groups];
                    newGroups[groupIndex] = {
                      ...group,
                      messageCount: messages.length,
                      status: calculateGroupStatus(group),
                    };
                  }
                }
              }

              return {
                groupSessions: {
                  ...state.groupSessions,
                  [sessionId]: updatedSession,
                },
                groups: newGroups,
              };
            });
          } else if (session.messageCount > 0) {
            // 如果会话显示有消息但加载为空，可能是数据损坏
            debugLog("LOAD_GROUP", "检测到组内会话数据丢失", {
              sessionId,
              expectedMessageCount: session.messageCount,
              actualMessagesLoaded: 0,
              loadedData: messages,
              dataType: typeof messages,
              possibleCauses: [
                "IndexedDB 数据损坏",
                "存储权限问题",
                "浏览器存储限制",
                "数据迁移问题",
                "组内会话数据不一致",
              ],
            });
            console.warn(
              `[ChatStore] 组会话 ${sessionId} 显示有 ${session.messageCount} 条消息，但加载为空`,
            );
            // 标记为错误状态
            set((state) => {
              const updatedSession = {
                ...session,
                messages: session.messages || [],
                status: "error" as const,
              };

              return {
                groupSessions: {
                  ...state.groupSessions,
                  [sessionId]: updatedSession,
                },
              };
            });
            return; // 提前返回，不继续处理
          } else {
            // 正常情况：没有消息的新会话
            debugLog("LOAD_GROUP", "设置空消息数组", {
              sessionId,
              reason: "messageCount为0",
              originalMessageCount: session.messageCount,
            });
            set((state) => {
              const updatedSession = {
                ...session,
                messages: [],
                messageCount: 0,
              };

              return {
                groupSessions: {
                  ...state.groupSessions,
                  [sessionId]: updatedSession,
                },
              };
            });
          }

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = get().groupSessions[sessionId];
          if (updatedSession && updatedSession.status !== "error") {
            try {
              debugLog("LOAD_GROUP", "开始更新会话统计信息", {
                sessionId,
                currentMessageCount: updatedSession.messageCount,
                currentMessagesLength: updatedSession.messages?.length || 0,
              });
              await updateSessionStats(updatedSession);

              // 更新组内会话状态
              set((state) => {
                const newGroupSessions = {
                  ...state.groupSessions,
                  [sessionId]: updatedSession,
                };

                // 如果是第一个会话，同时更新组的 messageCount
                let newGroups = state.groups;
                if (updatedSession.groupId) {
                  const groupIndex = state.groups.findIndex(
                    (g) => g.id === updatedSession.groupId,
                  );
                  if (groupIndex !== -1) {
                    const group = state.groups[groupIndex];
                    const firstSessionId = group.sessionIds[0];
                    if (firstSessionId === sessionId) {
                      debugLog("LOAD_GROUP", "更新组的最终消息计数", {
                        sessionId,
                        groupId: updatedSession.groupId,
                        messageCount: updatedSession.messageCount,
                      });
                      newGroups = [...state.groups];
                      newGroups[groupIndex] = {
                        ...group,
                        messageCount: updatedSession.messageCount,
                        status: calculateGroupStatus(group),
                      };
                    }
                  }
                }

                return {
                  groupSessions: newGroupSessions,
                  groups: newGroups,
                };
              });
            } catch (error) {
              debugLog("LOAD_GROUP", "更新会话统计信息失败", {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
              });
              console.error(
                `[ChatStore] Failed to update group session stats for ${sessionId}:`,
                error,
              );
            }
          }

          debugLog("LOAD_GROUP", "组内会话消息加载完成", {
            sessionId,
            finalMessagesCount:
              get().groupSessions[sessionId]?.messages?.length || 0,
            finalMessageCount:
              get().groupSessions[sessionId]?.messageCount || 0,
            loadSuccess: true,
          });
        } catch (error) {
          debugLog("LOAD_GROUP", "加载组内会话消息失败", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : undefined,
            isStorageError:
              error instanceof Error &&
              (error.message.includes("QuotaExceededError") ||
                error.message.includes("InvalidStateError") ||
                error.message.includes("NotSupportedError") ||
                error.message.includes("timeout")),
          });
          console.error(
            `[ChatStore] Failed to load messages for group session ${sessionId}`,
            error,
          );
          // 加载失败时不要清空数据，而是标记为错误状态
          set((state) => {
            const updatedSession = {
              ...session,
              status: "error" as const,
              // 保持原有的消息不变
              messages: session.messages || [],
            };

            return {
              groupSessions: {
                ...state.groupSessions,
                [sessionId]: updatedSession,
              },
            };
          });
        }
      },

      // 删除组内会话
      async deleteGroupSession(sessionId: string): Promise<void> {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          console.warn(`[ChatStore] No current group found`);
          return;
        }

        const sessionIndex = currentGroup.sessionIds.indexOf(sessionId);
        if (sessionIndex === -1) {
          console.warn(
            `[ChatStore] Session ${sessionId} not found in current group`,
          );
          return;
        }

        const deletedSession = groupSessions[sessionId];
        if (!deletedSession) {
          console.warn(
            `[ChatStore] Group session ${sessionId} not found in groupSessions`,
          );
          return;
        }

        // 检查是否是组内唯一的会话
        const isLastSession = currentGroup.sessionIds.length === 1;

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          // 确保包含所有必要的状态字段
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          chatListView: get().chatListView,
          models: get().models,
          accessCode: get().accessCode,
        };

        // 准备新的会话ID列表和状态更新
        let newSessionIds = [...currentGroup.sessionIds];
        let newCurrentSessionIndex = currentGroup.currentSessionIndex;
        let newGroupSessions = { ...groupSessions };
        let newSessionToAdd: ChatSession | null = null;

        // 如果删除的是最后一个会话，先创建新会话
        if (isLastSession) {
          // 创建新的组内会话
          newSessionToAdd = createEmptySession();
          newSessionToAdd.groupId = currentGroup.id;
          newSessionToAdd.title = Locale.Session.Title.DefaultGroup;

          // 保存会话消息
          await get().saveSessionMessages(newSessionToAdd);

          // 更新会话ID列表和索引
          newSessionIds = [newSessionToAdd.id];
          newCurrentSessionIndex = 0;
          newGroupSessions[newSessionToAdd.id] = newSessionToAdd;
        } else {
          // 删除指定会话
          newSessionIds.splice(sessionIndex, 1);

          // 计算删除后的当前会话索引
          if (sessionIndex < currentGroup.currentSessionIndex) {
            newCurrentSessionIndex--;
          } else if (sessionIndex === currentGroup.currentSessionIndex) {
            // 如果删除的是当前会话，选择前一个会话，如果没有则选择下一个
            newCurrentSessionIndex = Math.max(0, sessionIndex - 1);
          }
        }

        // 从 groupSessions 中删除被删除的会话
        delete newGroupSessions[sessionId];

        // 立即更新UI状态（一次性完成删除和添加新会话）
        set((state) => {
          const newGroups = [...state.groups];

          // 更新组信息
          let updatedGroup = {
            ...currentGroup,
            sessionIds: newSessionIds,
            currentSessionIndex: newCurrentSessionIndex,
          };

          // 更新父组的状态计数：减少被删除会话的状态计数
          if (deletedSession.status === "error") {
            updatedGroup.errorCount = Math.max(0, updatedGroup.errorCount - 1);
          } else if (deletedSession.status === "pending") {
            updatedGroup.pendingCount = Math.max(
              0,
              updatedGroup.pendingCount - 1,
            );
          }

          // 如果是删除最后一个会话并创建新会话，重置计数
          if (isLastSession && newSessionToAdd) {
            updatedGroup.title = newSessionToAdd.title;
            updatedGroup.messageCount = newSessionToAdd.messageCount;
            updatedGroup.errorCount = 0;
            updatedGroup.pendingCount = 0;
          } else if (sessionIndex === 0 && newSessionIds.length > 0) {
            // 删除的是第一个会话，更新组的标题和 messageCount 为新的第一个会话的标题和 messageCount
            const newFirstSessionId = newSessionIds[0];
            const newFirstSession = newGroupSessions[newFirstSessionId];
            if (newFirstSession) {
              updatedGroup.title = newFirstSession.title;
              updatedGroup.messageCount = newFirstSession.messageCount;
            }
          }

          // 重新计算组状态
          updatedGroup.status = calculateGroupStatus(updatedGroup);

          newGroups[currentGroupIndex] = updatedGroup;

          return {
            groups: newGroups,
            groupSessions: newGroupSessions,
          };
        });

        // **在切换到新会话后，立即加载其消息**
        if (isLastSession && newSessionToAdd) {
          // 如果是新创建的会话，加载其消息
          await get().loadGroupSessionMessages(newSessionToAdd.id);
        } else if (newSessionIds[newCurrentSessionIndex]) {
          // 如果是切换到现有会话，加载其消息
          await get().loadGroupSessionMessages(
            newSessionIds[newCurrentSessionIndex],
          );
        }

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.delete(sessionId),
              chatInputStorage.delete(sessionId),
              systemMessageStorage.delete(sessionId),
            ]);
          } catch (error) {
            console.error(
              `[ChatStore] Failed to delete group session ${sessionId} data:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreGroupSession = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复组内会话状态
          set(() => restoreState);

          // 确保恢复的会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            await get().loadGroupSessionMessages(sessionId);
          }, 0);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        const toastMessage = isLastSession
          ? Locale.Chat.DeleteLastGroupSessionToast
          : Locale.Chat.DeleteSessionToast;

        showToast(
          toastMessage,
          {
            text: Locale.Chat.Revert,
            onClick: restoreGroupSession,
          },
          8000,
        );
      },

      // 删除整个组及其所有会话
      async deleteGroup(groupId: string): Promise<void> {
        const { groups, currentGroupIndex, groupSessions } = get();
        const targetGroup = groups.find((g) => g.id === groupId);

        if (!targetGroup) {
          console.warn(`[ChatStore] Group ${groupId} not found`);
          return;
        }

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          chatListView: get().chatListView,
          // 确保包含所有必要的状态字段
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          models: get().models,
          accessCode: get().accessCode,
        };

        // 获取组内所有会话ID
        const sessionIds = [...targetGroup.sessionIds];

        // 计算删除后的当前组索引
        const groupIndex = groups.findIndex((g) => g.id === groupId);
        let newCurrentGroupIndex = currentGroupIndex;
        if (groupIndex < currentGroupIndex) {
          newCurrentGroupIndex--;
        } else if (groupIndex === currentGroupIndex) {
          // 如果删除的是当前组，选择前一个组，如果没有则选择下一个
          newCurrentGroupIndex = Math.max(0, groupIndex - 1);
        }

        // 立即更新UI状态（从组列表中移除）
        set((state) => {
          const newGroups = state.groups.filter((g) => g.id !== groupId);
          const newGroupSessions = { ...state.groupSessions };

          // 从 groupSessions 中移除所有相关会话
          sessionIds.forEach((sessionId) => {
            delete newGroupSessions[sessionId];
          });

          return {
            groups: newGroups,
            groupSessions: newGroupSessions,
            currentGroupIndex: newCurrentGroupIndex,
            // 如果删除的是当前组，切换到组列表视图
            ...(groupIndex === currentGroupIndex
              ? { chatListView: "groups" as const }
              : {}),
          };
        });

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            // 删除所有会话的相关数据
            const deletePromises = sessionIds.map(async (sessionId) => {
              await Promise.all([
                messageStorage.delete(sessionId),
                chatInputStorage.delete(sessionId),
                systemMessageStorage.delete(sessionId),
              ]);
            });

            await Promise.all(deletePromises);
          } catch (error) {
            console.error(
              `[ChatStore] Failed to delete group ${groupId} data:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreGroup = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复组状态
          set(() => restoreState);

          // 确保恢复的组内会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            for (const sessionId of sessionIds) {
              await get().loadGroupSessionMessages(sessionId);
            }
          }, 0);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteGroupToast,
          {
            text: Locale.Chat.Revert,
            onClick: restoreGroup,
          },
          8000,
        );
      },

      // 分支会话：创建一个包含指定消息历史的新会话
      async branchSession(
        originalSession: ChatSession,
        messagesToCopy: ChatMessage[],
        systemMessageData: any,
        branchTopic: string,
      ) {
        const newSession = createBranchSession(
          originalSession,
          messagesToCopy,
          branchTopic,
        );

        // 为新分支会话保存消息
        await get().saveSessionMessages(newSession);

        // **修复：在状态更新前先保存系统提示词**
        if (
          systemMessageData &&
          (systemMessageData.text.trim() || systemMessageData.images.length > 0)
        ) {
          // 数据未恢复时，禁止系统消息持久化
          if (!isDataRestored) {
            debugLog(
              "SAVE_SYSTEM_MESSAGE",
              "❌ 数据未恢复，禁止系统消息持久化",
              {
                sessionId: newSession.id,
                isDataRestored,
                timestamp: Date.now(),
              },
            );
          } else {
            try {
              const success = await systemMessageStorage.save(
                newSession.id,
                systemMessageData,
              );
              if (!success) {
                console.error("保存系统提示词到新分支会话失败");
              }
            } catch (error) {
              console.error("保存系统提示词到新分支会话失败:", error);
            }
          }
        }

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionIndex: 0, // 切换到新创建的分支会话
        }));

        // 确保新会话的消息已正确加载（虽然是新创建的，但为了保险起见）
        await get().loadSessionMessages(0);

        return newSession;
      },

      // 从指定消息创建分支会话
      async branchSessionFrom(message: ChatMessage, messageIndex: number) {
        const session = get().currentSession();
        if (!session) {
          throw new Error("当前会话不存在");
        }

        // 组内会话不支持分支功能
        if (session.groupId) {
          throw new Error("组内会话不支持分支功能");
        }

        try {
          // 复制会话标题并标注分支
          const originalTitle = session.title || DEFAULT_TITLE;

          // 生成分支标题，支持递增数字
          const getBranchTitle = (title: string): string => {
            // 匹配 (分支) 或 (分支数字) 的正则表达式
            const branchRegex = /\(分支(\d*)\)$/;
            const match = title.match(branchRegex);

            if (!match) {
              // 没有匹配到分支标记，直接添加 (分支)
              return `${title} (分支)`;
            } else {
              // 匹配到分支标记，递增数字
              const currentNumber = match[1] ? parseInt(match[1]) : 1;
              const nextNumber = currentNumber + 1;
              const baseTitle = title.replace(branchRegex, "");
              return `${baseTitle} (分支${nextNumber})`;
            }
          };

          const branchTitle = getBranchTitle(originalTitle);

          // 复制系统提示词
          const systemMessageData = await systemMessageStorage.get(session.id);

          // 获取完整的消息历史（不受分页限制）
          const fullMessages = session.messages.filter(
            (m) => m.role !== "system",
          );

          // 通过message.id在完整历史中找到真实位置（不依赖分页后的索引）
          const realIndex = fullMessages.findIndex((m) => m.id === message.id);
          if (realIndex === -1) {
            throw new Error("无法在完整历史中找到目标消息");
          }

          // 复制消息历史（包含该消息及之前的所有消息）
          const originalMessages = fullMessages.slice(0, realIndex + 1);

          // 为每条消息重新生成ID，确保唯一性，保持其他属性不变
          const messagesToCopy = originalMessages.map((message) => {
            return {
              ...message,
              id: nanoid(), // 使用普通nanoid格式
            };
          });

          // 使用现有的branchSession方法，系统提示词会在内部自动保存
          const newSession = await get().branchSession(
            session,
            messagesToCopy,
            systemMessageData,
            branchTitle,
          );

          return newSession;
        } catch (error) {
          console.error("分支会话失败:", error);
          throw error;
        }
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      async deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        // **保存删除前的完整状态用于撤销**
        const restoreState = {
          sessions: get().sessions,
          currentSessionIndex: get().currentSessionIndex,
          // 确保包含所有必要的状态字段
          groups: get().groups,
          groupSessions: get().groupSessions,
          currentGroupIndex: get().currentGroupIndex,
          chatListView: get().chatListView,
          models: get().models,
          accessCode: get().accessCode,
        };
        const deletedSessionIndex = index;

        // 准备新的状态
        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          const newSession = createEmptySession();
          sessions.push(newSession);
          // 为新创建的空会话保存（空的）消息
          await get().saveSessionMessages(newSession);
        }

        // 立即更新UI状态（从sessions数组中移除）
        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        // **修复：在切换到新session后，立即加载其消息**
        await get().loadSessionMessages(nextIndex);

        // **延迟删除相关数据的定时器**
        let deleteTimer: NodeJS.Timeout | null = null;

        const performActualDeletion = async () => {
          try {
            await Promise.all([
              messageStorage.delete(deletedSession.id),
              chatInputStorage.delete(deletedSession.id),
              systemMessageStorage.delete(deletedSession.id),
            ]);
          } catch (error) {
            console.error(
              `[DeleteSession] 删除会话 ${deletedSession.id} 的数据失败:`,
              error,
            );
          }
        };

        // **撤销删除的功能**
        const restoreSession = async () => {
          // 取消延迟删除定时器
          if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
          }

          // 恢复会话状态
          set(() => restoreState);

          // 确保恢复的会话消息已加载
          // 注意：这里需要等待状态更新完成后再加载消息
          setTimeout(async () => {
            await get().loadSessionMessages(deletedSessionIndex);
          }, 0);
        };

        // 设置8秒后的延迟删除
        deleteTimer = setTimeout(() => {
          performActualDeletion();
          deleteTimer = null;
        }, 8000);

        // **显示带撤销选项的Toast**
        showToast(
          Locale.Chat.DeleteSessionToast,
          {
            text: Locale.Chat.Revert,
            onClick: restoreSession,
          },
          8000,
        );
      },

      currentSession() {
        // 严格要求数据恢复完成
        if (!isDataRestored) {
          debugLog("CURRENT_SESSION", "❌ 数据未恢复，禁止访问当前会话", {
            isDataRestored,
            isHydrated,
            timestamp: Date.now(),
          });
          // 返回默认会话以避免崩溃，但记录错误
          return createEmptySession();
        }

        const {
          chatListView: chatListView,
          chatListGroupView,
          groups,
          currentGroupIndex,
          groupSessions,
          sessions,
          currentSessionIndex,
        } = get();

        // debugLog("CURRENT_SESSION", "获取当前会话", {
        //   chatListView,
        //   chatListGroupView,
        //   currentSessionIndex,
        //   currentGroupIndex,
        //   sessionsCount: sessions.length,
        //   groupsCount: groups.length,
        //   groupSessionsCount: Object.keys(groupSessions).length,
        // });

        // 普通会话模式：返回当前普通会话
        if (chatListView === "sessions") {
          let index = currentSessionIndex;
          const validIndex = validateSessionIndex(index, sessions.length);
          if (validIndex !== index) {
            debugLog("CURRENT_SESSION", "普通会话索引无效，需要修正", {
              currentIndex: index,
              validIndex,
              sessionsCount: sessions.length,
            });
            // 使用 setTimeout 避免在渲染期间触发状态更新
            setTimeout(() => {
              set(() => ({ currentSessionIndex: validIndex }));
              get().loadSessionMessages(validIndex);
            }, 0);
            index = validIndex;
          }
          const session = sessions[index];
          // debugLog("CURRENT_SESSION", "返回普通会话", {
          //   sessionIndex: index,
          //   sessionId: session?.id,
          //   title: session?.title,
          //   messageCount: session?.messageCount,
          //   messagesLength: session?.messages?.length || 0,
          // });
          return session;
        }

        // 组会话模式：根据组内视图决定返回哪个会话
        if (chatListView === "groups") {
          // 组内会话模式：返回当前组的当前会话
          if (chatListGroupView === "group-sessions") {
            const currentGroup = groups[currentGroupIndex];
            debugLog("CURRENT_SESSION", "组内会话模式", {
              currentGroupIndex,
              groupExists: !!currentGroup,
              groupId: currentGroup?.id,
              groupTitle: currentGroup?.title,
              sessionIdsCount: currentGroup?.sessionIds.length || 0,
              currentSessionIndex: currentGroup?.currentSessionIndex,
            });

            if (currentGroup && currentGroup.sessionIds.length > 0) {
              const currentSessionId =
                currentGroup.sessionIds[currentGroup.currentSessionIndex];
              const session = groupSessions[currentSessionId];
              if (session) {
                debugLog("CURRENT_SESSION", "返回组内当前会话", {
                  sessionId: currentSessionId,
                  title: session.title,
                  messageCount: session.messageCount,
                  messagesLength: session.messages?.length || 0,
                });
                return session;
              } else {
                debugLog("CURRENT_SESSION", "组内会话不存在于groupSessions中", {
                  sessionId: currentSessionId,
                  availableSessionIds: Object.keys(groupSessions),
                });
                console.warn(
                  `[ChatStore] Group session ${currentSessionId} not found in groupSessions`,
                );
              }
            }
            // 如果组内会话模式但没有找到会话，使用 setTimeout 避免在渲染期间触发状态更新
            debugLog("CURRENT_SESSION", "组内会话模式失败，切换回组列表模式");
            setTimeout(() => {
              set({ chatListGroupView: "groups" });
            }, 0);
          }

          // 组列表模式：返回当前组的第一个会话
          if (chatListGroupView === "groups") {
            const currentGroup = groups[currentGroupIndex];
            debugLog("CURRENT_SESSION", "组列表模式", {
              currentGroupIndex,
              groupExists: !!currentGroup,
              groupId: currentGroup?.id,
              groupTitle: currentGroup?.title,
              sessionIdsCount: currentGroup?.sessionIds.length || 0,
            });

            if (currentGroup && currentGroup.sessionIds.length > 0) {
              const firstSessionId = currentGroup.sessionIds[0];
              const session = groupSessions[firstSessionId];
              if (session) {
                debugLog("CURRENT_SESSION", "返回组的第一个会话", {
                  sessionId: firstSessionId,
                  title: session.title,
                  messageCount: session.messageCount,
                  messagesLength: session.messages?.length || 0,
                });
                return session;
              } else {
                debugLog(
                  "CURRENT_SESSION",
                  "组的第一个会话不存在于groupSessions中",
                  {
                    sessionId: firstSessionId,
                    availableSessionIds: Object.keys(groupSessions),
                  },
                );
                console.warn(
                  `[ChatStore] Group session ${firstSessionId} not found in groupSessions`,
                );
              }
            }
          }
        }

        // 兜底：返回当前普通会话
        debugLog("CURRENT_SESSION", "使用兜底策略，返回普通会话");
        let index = currentSessionIndex;
        const validIndex = validateSessionIndex(index, sessions.length);
        if (validIndex !== index) {
          debugLog("CURRENT_SESSION", "兜底会话索引无效，需要修正", {
            currentIndex: index,
            validIndex,
            sessionsCount: sessions.length,
          });
          // 使用 setTimeout 避免在渲染期间触发状态更新
          setTimeout(() => {
            set(() => ({ currentSessionIndex: validIndex }));
            get().loadSessionMessages(validIndex);
          }, 0);
          index = validIndex;
        }
        const session = sessions[index];
        debugLog("CURRENT_SESSION", "返回兜底会话", {
          sessionIndex: index,
          sessionId: session?.id,
          title: session?.title,
          messageCount: session?.messageCount,
          messagesLength: session?.messages?.length || 0,
        });
        return session;
      },

      handleMessageComplete(
        message: ChatMessage,
        session: ChatSession,
        usage?: any,
      ) {
        const latestSession = get().getLatestSession(session);
        const updateSession = (session: ChatSession) => {
          session.lastUpdate = Date.now();
        };
        if (latestSession.groupId) {
          get().updateGroupSession(latestSession, updateSession);
        } else {
          get().updateSession(latestSession, updateSession);
        }
        get().generateSessionTitle(false, latestSession);
      },

      getLatestSession(session: ChatSession) {
        return session.groupId
          ? get().groupSessions[session.id]
          : get().sessions.find((s) => s.id === session.id) || session;
      },

      async onSendMessage(
        content: string,
        attachImages?: string[],
        messageIdx?: number,
        targetSessionId?: string, // 新增：指定目标会话ID
        batchId?: string, // 新增：指定batchId，用于批量应用
        modelBatchId?: string, // 新增：指定模型消息的batchId，用于批量应用时保持模型消息batch id一致
      ) {
        // 严格要求数据恢复完成
        if (!isDataRestored) {
          debugLog("SEND_MESSAGE", "❌ 数据未恢复，禁止发送消息", {
            isDataRestored,
            isHydrated,
            timestamp: Date.now(),
          });
          throw new Error("数据未恢复，无法发送消息");
        }
        let session: ChatSession;
        if (targetSessionId) {
          // 查找指定的会话
          const groupSession = get().groupSessions[targetSessionId];
          const normalSession = get().sessions.find(
            (s) => s.id === targetSessionId,
          );
          session = groupSession || normalSession || get().currentSession();
        } else {
          session = get().currentSession();
        }

        // 确保消息已加载
        if (!session.messages || session.messages.length === 0) {
          if (session.groupId) {
            await get().loadGroupSessionMessages(session.id);
          } else {
            await get().loadSessionMessages(get().currentSessionIndex);
          }
        }

        let mContent: string | MultimodalContent[] = content;

        if (attachImages && attachImages.length > 0) {
          mContent = [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        }

        // 为组内会话生成batchId，支持分别指定用户消息和模型消息的batchId
        let userBatchId: string | undefined;
        let finalModelBatchId: string | undefined;

        if (session.groupId) {
          // 用户消息使用传入的batchId或生成新的
          userBatchId = batchId || nanoid(12);
          // 模型消息使用传入的modelBatchId或生成新的
          finalModelBatchId = modelBatchId || nanoid(12);
        }

        let userMessage: ChatMessage = createMessage(
          {
            role: "user",
            content: mContent,
          },
          userBatchId,
        );

        const modelMessage = createMessage(
          {
            role: "assistant",
            content: "",
            streaming: true,
            model: session.model,
          },
          finalModelBatchId,
        );

        // get recent messages for the target session
        let recentMessages: ChatMessage[];
        if (targetSessionId && targetSessionId !== get().currentSession().id) {
          // 如果指定了目标会话且不是当前会话，使用目标会话的消息（包含系统提示词）
          recentMessages = await prepareMessagesForApi(session);
        } else {
          // 否则使用当前会话的消息（保持原有逻辑）
          recentMessages = await get().getCurrentSessionMessages();
        }

        let sendMessages = prepareSendMessages(
          recentMessages,
          userMessage,
          messageIdx,
        );

        const messageIndex = session.messages.length + 1;

        // 始终获取最新的 session 对象
        let latestSession: ChatSession | undefined;
        if (session.groupId) {
          latestSession = get().groupSessions[session.id];
        } else {
          latestSession = get().sessions.find((s) => s.id === session.id);
        }
        if (latestSession) {
          session = latestSession;
        }

        // 🔧 优化：基于 batchId 的消息更新逻辑
        if (session.groupId && userBatchId) {
          // 查找相同 batchId 的用户消息
          const existingUserMsgIndex = session.messages.findIndex((m) => {
            const parsed = parseGroupMessageId(m.id);
            return (
              parsed.isValid &&
              parsed.batchId === userBatchId &&
              m.role === "user"
            );
          });

          if (existingUserMsgIndex !== -1) {
            // 找到现有用户消息，更新其内容
            get().smartUpdateSession(session, (session) => {
              session.messages[existingUserMsgIndex] = {
                ...session.messages[existingUserMsgIndex],
                content: mContent,
              };

              // 删除该用户消息后面紧跟的模型消息（如果存在）
              const nextMsgIndex = existingUserMsgIndex + 1;
              if (
                nextMsgIndex < session.messages.length &&
                session.messages[nextMsgIndex].role === "assistant"
              ) {
                session.messages.splice(nextMsgIndex, 1);
              }

              // 在用户消息后插入新的模型消息
              session.messages.splice(
                existingUserMsgIndex + 1,
                0,
                modelMessage,
              );
            });
          } else {
            // 没有找到现有消息，追加到末尾
            get().smartUpdateSession(session, (session) => {
              session.messages.push(userMessage, modelMessage);
            });
          }
        } else {
          // 非组内会话或没有指定 batchId，使用原有的 insertMessage 逻辑
          get().smartUpdateSession(session, (session) => {
            const savedUserMessage = {
              ...userMessage,
              content: mContent,
            };

            // 🔧 修复普通会话重试逻辑：当传递了 messageIdx 时，先删除原有消息再插入
            if (typeof messageIdx === "number" && messageIdx >= 0) {
              // 删除从 messageIdx 开始的用户消息和对应的模型回复
              // 通常是连续的 user -> assistant 对
              const deleteCount =
                messageIdx + 1 < session.messages.length &&
                session.messages[messageIdx + 1].role === "assistant"
                  ? 2
                  : 1;

              // 删除原有的消息
              session.messages.splice(messageIdx, deleteCount);

              // 在原位置插入新的用户消息和模型消息
              session.messages.splice(
                messageIdx,
                0,
                savedUserMessage,
                modelMessage,
              );
            } else {
              // 没有传 messageIdx，追加到末尾
              session.messages = insertMessage(
                session.messages,
                savedUserMessage,
                modelMessage,
                messageIdx,
              );
            }
          });
        }

        // 立即保存消息到独立存储 - 获取最新的会话对象
        const latestSessionForSave = get().getLatestSession(session);

        await get().saveSessionMessages(latestSessionForSave);

        // 异步更新包含系统提示词的完整统计信息
        const currentSession = get().currentSession();
        await updateSessionStats(currentSession);

        // 根据会话类型更新状态
        if (currentSession.groupId) {
          get().updateGroupSession(currentSession, (session) => {});
        } else {
          get().updateSession(currentSession, (session) => {});
        }

        // 🔧 批量模式：开始请求时增加计数器
        get().incrementBatchRequest();

        const api: ClientApi = getClientApi();
        // make request
        api.llm.chat({
          messages: sendMessages,
          model: session.model,
          onUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.content = message;
            }

            // 🔧 优化：只有当前可见会话触发UI渲染，后台会话完全不渲染
            get().smartUpdateSession(session, () => {});

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnUpdate = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                // 异步保存消息更新
                await get().saveSessionMessages(latestSessionOnUpdate);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnUpdate);

                // 最终状态同步（但不阻塞流式渲染）
                if (latestSessionOnUpdate.groupId) {
                  get().updateGroupSession(
                    latestSessionOnUpdate,
                    (session) => {},
                  );
                } else {
                  get().updateSession(latestSessionOnUpdate, (session) => {});
                }
              })
              .catch((error) => {
                console.error("[onSendMessage] onUpdate 异步操作失败:", error);
              });
          },
          onReasoningUpdate(message) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }

            // 🔧 优化：只有当前可见会话触发UI渲染，后台会话完全不渲染
            get().smartUpdateSession(session, () => {});

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnReasoning = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                // 异步保存消息更新
                await get().saveSessionMessages(latestSessionOnReasoning);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnReasoning);

                // 最终状态同步（但不阻塞流式渲染）
                if (latestSessionOnReasoning.groupId) {
                  get().updateGroupSession(
                    latestSessionOnReasoning,
                    (session) => {},
                  );
                } else {
                  get().updateSession(
                    latestSessionOnReasoning,
                    (session) => {},
                  );
                }
              })
              .catch((error) => {
                console.error(
                  "[onSendMessage] onReasoningUpdate 异步操作失败:",
                  error,
                );
              });
          },
          onFinish(message, responseRes, usage) {
            modelMessage.streaming = false;
            if (message) {
              modelMessage.content = message;
              modelMessage.date = new Date().toLocaleString();
              if (responseRes && responseRes.status !== 200) {
                modelMessage.isError = true;

                // 如果返回 401 未授权，清空 accessCode 并跳转到 auth 页面
                if (responseRes.status === 401) {
                  // 需要通过某种方式获取 navigate 函数
                  // 这里我们先在 window 对象上设置一个全局的处理函数
                  if (
                    typeof window !== "undefined" &&
                    (window as any).__handleUnauthorized
                  ) {
                    (window as any).__handleUnauthorized();
                  }
                }
              }

              get().handleMessageComplete(modelMessage, session, usage);
            }

            // 🔧 优化：智能更新UI状态，完成时强制渲染确保最终状态同步
            get().smartUpdateSession(session, () => {}, true);

            // 保存最终消息状态 - 获取最新会话对象
            const latestSessionOnFinish = get().getLatestSession(session);

            // 🔥 Stream 完成后强制保存（绕过频率限制）
            get().saveSessionMessages(latestSessionOnFinish, true);
            ChatControllerPool.remove(session.id, modelMessage.id);

            // 🔧 批量模式：请求完成时减少计数器
            get().decrementBatchRequest();
          },

          onError(error) {
            const isAborted = error.message?.includes?.("aborted");

            modelMessage.content +=
              "\n\n" +
              prettyObject({
                error: true,
                message: error.message,
              });
            modelMessage.streaming = false;
            userMessage.isError = !isAborted;
            modelMessage.isError = !isAborted;

            // 🔧 优化：智能更新UI状态，错误时强制渲染确保错误状态显示
            get().smartUpdateSession(session, () => {}, true);

            // 🔧 优化：异步操作不阻塞UI渲染
            const latestSessionOnError = get().getLatestSession(session);

            // 使用 Promise.resolve() 确保异步操作不阻塞当前渲染
            Promise.resolve()
              .then(async () => {
                console.log("[onSendMessage] ❌ onError 保存消息", {
                  sessionId: session.id,
                  errorMessage: error.message,
                  isAborted,
                  userMessageError: userMessage.isError,
                  modelMessageError: modelMessage.isError,
                  latestMessageCount:
                    latestSessionOnError.messages?.length || 0,
                  step: "onError",
                });

                // 异步保存错误状态的消息（强制保存）
                await get().saveSessionMessages(latestSessionOnError, true);

                // 异步更新包含系统提示词的完整统计信息
                await updateSessionStats(latestSessionOnError);

                // 最终状态同步（但不阻塞错误处理）
                if (latestSessionOnError.groupId) {
                  get().updateGroupSession(
                    latestSessionOnError,
                    (session) => {},
                  );
                } else {
                  get().updateSession(latestSessionOnError, (session) => {});
                }
              })
              .catch((saveError) => {
                console.error(
                  "[onSendMessage] onError 异步操作失败:",
                  saveError,
                );
              });

            ChatControllerPool.remove(
              session.id,
              modelMessage.id ?? String(messageIndex),
            );

            // 🔧 批量模式：请求出错时也减少计数器
            get().decrementBatchRequest();

            console.error("[Chat] failed ", error);
          },
          onController(controller) {
            // collect controller for stop/retry
            ChatControllerPool.addController(
              session.id,
              modelMessage.id ?? String(messageIndex),
              controller,
            );
          },
        });
      },

      async getCurrentSessionMessages() {
        // 严格要求数据恢复完成
        if (!isDataRestored) {
          debugLog(
            "GET_CURRENT_MESSAGES",
            "❌ 数据未恢复，禁止获取当前会话消息",
            {
              isDataRestored,
              isHydrated,
              timestamp: Date.now(),
            },
          );
          throw new Error("数据未恢复，无法获取当前会话消息");
        }

        const session = get().currentSession();

        // **核心改动：如果消息未加载，先加载它们**
        if (session && (!session.messages || session.messages.length === 0)) {
          if (session.groupId) {
            await get().loadGroupSessionMessages(session.id);
          } else {
            await get().loadSessionMessages(get().currentSessionIndex);
          }
        }
        // get() 会获取最新状态，此时 messages 应该已加载
        const finalSession = get().currentSession();
        return await prepareMessagesForApi(finalSession);
      },

      async updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        set((state) => {
          const sessions = [...state.sessions];
          const session = sessions[sessionIndex];
          if (!session) return {};
          const messages = session.messages;
          updater(messages?.[messageIndex]);
          updateSessionStatsBasic(session); // 先同步更新基础统计信息
          return { sessions };
        });
        // 保存最新
        const session = get().sessions[sessionIndex];
        if (session) {
          await get().saveSessionMessages(session);

          // 异步更新包含系统提示词的完整统计信息
          await updateSessionStats(session);
          get().updateSession(session, (session) => {});
        }
      },

      async generateSessionTitle(
        refreshTitle: boolean = false,
        session: ChatSession,
      ) {
        await generateSessionTitle(session, refreshTitle, (newTitle) => {
          // 根据会话类型选择更新方法
          if (session.groupId) {
            get().updateGroupSession(session, (session) => {
              session.title = newTitle;
            });
          } else {
            get().updateSession(session, (session) => {
              session.title = newTitle;
            });
          }
        });
      },

      updateSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          const index = state.sessions.findIndex((s) => s.id === session.id);
          if (index < 0) return {}; // 如果会话不存在，直接返回空对象
          const updatedSession = { ...state.sessions[index] }; // 修改浅拷贝
          updater(updatedSession); // 修改会话浅拷贝
          const sessions = [...state.sessions]; // 会话数组浅拷贝
          sessions[index] = updatedSession; // 更新会话数组浅拷贝
          return { sessions }; // 返回包含新 sessions 数组的状态对象，Zustand 会将这个对象与当前状态合并，触发组件重新渲染
        });
      },

      // 更新组内会话并同步组标题和消息数量
      updateGroupSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        set((state) => {
          // 一定要以 groupSessions 里的最新对象为基础，防止被旧对象覆盖
          const baseSession = state.groupSessions[session.id] || session;
          const updatedSession = { ...baseSession };

          // 保存更新前的状态，用于计算状态变化
          const oldStatus = updatedSession.status;

          // 应用更新器
          updater(updatedSession);

          // 如果状态发生了变化，需要更新父组的计数
          const newStatus = updatedSession.status;
          const statusChanged = oldStatus !== newStatus;

          const newGroupSessions = {
            ...state.groupSessions,
            [session.id]: updatedSession,
          };

          // 更新组状态
          let newGroups = state.groups;
          if (session.groupId) {
            const groupIndex = state.groups.findIndex(
              (g) => g.id === session.groupId,
            );
            if (groupIndex !== -1) {
              const group = state.groups[groupIndex];
              const updatedGroup = { ...group };

              // 如果状态发生了变化，安全地更新计数
              if (statusChanged) {
                // 减少旧状态的计数
                if (oldStatus === "error") {
                  updatedGroup.errorCount = Math.max(
                    0,
                    updatedGroup.errorCount - 1,
                  );
                } else if (oldStatus === "pending") {
                  updatedGroup.pendingCount = Math.max(
                    0,
                    updatedGroup.pendingCount - 1,
                  );
                }

                // 增加新状态的计数
                if (newStatus === "error") {
                  updatedGroup.errorCount += 1;
                } else if (newStatus === "pending") {
                  updatedGroup.pendingCount += 1;
                }

                // 重新计算组状态
                updatedGroup.status = calculateGroupStatus(updatedGroup);
              }

              // 如果是第一个会话，同步组标题和消息数量
              const firstSessionId = group.sessionIds[0];
              if (firstSessionId === session.id) {
                updatedGroup.title = updatedSession.title;
                updatedGroup.messageCount = updatedSession.messageCount;
              }

              newGroups = [...state.groups];
              newGroups[groupIndex] = updatedGroup;
            }
          }

          return {
            groupSessions: newGroupSessions,
            groups: newGroups,
          };
        });
      },

      fetchModels() {
        if (fetchState > 0) return;
        fetchState = 1;
        fetch("/api/models", {
          method: "post",
          body: null,
          headers: {
            ...getHeaders(),
          },
        })
          .then((res) => res.json())
          .then((res: any) => {
            console.log("[Config] got config from server", res);
            set(() => ({ models: res.models }));
          })
          .catch(() => {
            console.error("[Config] failed to fetch config");
          })
          .finally(() => {
            fetchState = 2;
          });
      },

      // 新增：从多个文件创建会话组
      async createGroupFromFiles(files: File[]): Promise<ChatGroup | null> {
        try {
          // 先进行 IndexedDB 健康检查
          const isHealthy = await messageStorage.healthCheck();
          if (!isHealthy) {
            console.error(
              "[ChatStore] IndexedDB 健康检查失败，请重启浏览器重试",
            );
            showToast("存储系统异常，请重启浏览器重试");
            return null;
          }

          // 过滤支持的文件类型
          const supportedFiles = files.filter((file) => {
            const ext = file.name.split(".").pop()?.toLowerCase();
            return ["jpg", "jpeg", "png", "webp", "md", "txt"].includes(
              ext || "",
            );
          });

          if (supportedFiles.length === 0) {
            console.warn("[ChatStore] 没有找到支持的文件类型");
            showToast(
              "没有找到支持的文件类型（支持：jpg, jpeg, png, webp, md, txt）",
            );
            return null;
          }

          // 按文件名排序
          const sortedFiles = supportedFiles.sort((a, b) =>
            a.name.localeCompare(b.name),
          );

          // 创建组
          const groupId = nanoid();
          const groupTitle = `文件组 - ${new Date().toLocaleString("zh-CN")}`;

          const newGroup: ChatGroup = {
            id: groupId,
            title: groupTitle,
            sessionIds: [],
            messageCount: 0,
            status: "normal",
            pendingCount: 0,
            errorCount: 0,
            currentSessionIndex: 0,
          };

          // 为每个文件创建一个会话
          const groupSessions: GroupSession = {};
          const sessionIds: string[] = [];

          for (let i = 0; i < sortedFiles.length; i++) {
            const file = sortedFiles[i];
            const sessionId = nanoid();

            // 创建会话
            const session: ChatSession = {
              id: sessionId,
              title: Locale.Session.Title.DefaultGroup,
              sourceName: file.name, // 记录源文件名
              model: get().models[0], // 使用第一个可用模型
              messageCount: 0,
              status: "normal",
              groupId: groupId,
              lastUpdate: Date.now(),
              messages: [],
            };

            // 处理文件内容并设置为系统提示词
            let systemText = "";
            let systemImages: string[] = [];

            try {
              const ext = file.name.split(".").pop()?.toLowerCase();

              if (["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
                // 图片文件：上传图片并添加到系统提示词
                const imageUrl = await uploadImage(file);
                systemImages.push(imageUrl);
              } else if (["md", "txt"].includes(ext || "")) {
                // 文本文件：读取内容作为系统提示词
                const text = await file.text();
                systemText = text;
              }

              // 保存系统提示词
              if (systemText.trim() || systemImages.length > 0) {
                // 数据未恢复时，禁止系统消息持久化
                if (!isDataRestored) {
                  debugLog(
                    "SAVE_SYSTEM_MESSAGE",
                    "❌ 数据未恢复，禁止系统消息持久化",
                    {
                      sessionId,
                      isDataRestored,
                      timestamp: Date.now(),
                    },
                  );
                } else {
                  await systemMessageStorage.save(sessionId, {
                    text: systemText,
                    images: systemImages,
                    scrollTop: 0,
                    selection: { start: 0, end: 0 },
                    updateAt: Date.now(),
                  });
                }
              }

              // 保存会话消息（空消息）
              await get().saveSessionMessages(session);

              // 更新会话统计信息
              await updateSessionStats(session);

              // 添加到组内会话
              groupSessions[sessionId] = session;
              sessionIds.push(sessionId);
            } catch (error) {
              console.error(`[ChatStore] 处理文件 ${file.name} 失败:`, error);
              // 即使处理失败，也创建会话，但标记为错误状态
              session.status = "error";
              groupSessions[sessionId] = session;
              sessionIds.push(sessionId);
            }
          }

          // 更新组信息
          newGroup.sessionIds = sessionIds;
          newGroup.messageCount = sessionIds.length;

          // 计算组状态
          const errorCount = sessionIds.filter(
            (id) => groupSessions[id].status === "error",
          ).length;
          const pendingCount = sessionIds.filter(
            (id) => groupSessions[id].status === "pending",
          ).length;
          newGroup.errorCount = errorCount;
          newGroup.pendingCount = pendingCount;
          newGroup.status = calculateGroupStatus(newGroup);

          // 更新 store 状态
          set((state) => ({
            groups: [newGroup, ...state.groups],
            groupSessions: {
              ...state.groupSessions,
              ...groupSessions,
            },
            currentGroupIndex: 0,
            chatListView: "groups" as const,
            chatListGroupView: "group-sessions" as const,
          }));

          showToast(`成功创建会话组，包含 ${sortedFiles.length} 个文件`);

          return newGroup;
        } catch (error) {
          console.error("[ChatStore] 从文件创建会话组失败:", error);
          showToast("创建会话组失败，请重试");
          return null;
        }
      },

      // 统一管理导出格式的读取
      async getExportFormat(): Promise<string> {
        try {
          const format = await jchatStorage.getItem(StoreKey.ExportFormat);
          return typeof format === "string" ? format : "image";
        } catch (e) {
          return "image";
        }
      },
      // 统一管理导出格式的保存
      async setExportFormat(format: string): Promise<void> {
        // 数据未恢复时，禁止数据持久化
        if (!isDataRestored) {
          debugLog("SET_EXPORT_FORMAT", "❌ 数据未恢复，禁止导出格式持久化", {
            format,
            isDataRestored,
            timestamp: Date.now(),
          });
          return;
        }

        try {
          await jchatStorage.setItem(StoreKey.ExportFormat, format);
        } catch (e) {
          // ignore
        }
      },
    };

    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 5.4,
    storage: jchatStorage,

    /**
     * **核心改动：使用 partialize 排除 messages 和 mobileViewState**
     * 这个函数在持久化状态之前被调用。
     * 我们返回一个不包含任何 session.messages 和 mobileViewState 的新状态对象。
     */
    partialize: (state) => {
      // 数据未恢复时，禁止状态持久化
      if (!isDataRestored) {
        debugLog("PERSIST", "❌ 数据未恢复，禁止状态持久化", {
          isDataRestored,
          timestamp: Date.now(),
        });
        return {}; // 返回空对象，不进行持久化
      }

      debugLog("PERSIST", "开始状态持久化", {
        sessionsCount: state.sessions.length,
        groupsCount: state.groups.length,
        groupSessionsCount: Object.keys(state.groupSessions).length,
        currentSessionIndex: state.currentSessionIndex,
        currentGroupIndex: state.currentGroupIndex,
        chatListView: state.chatListView,
        hasMobileViewState: "mobileViewState" in state,
      });

      // 创建一个没有 messages 和 mobileViewState 的 state副本
      const { mobileViewState, ...stateWithoutMobileView } = state;
      const stateToPersist = {
        ...stateWithoutMobileView,
        sessions: state.sessions.map((session) => {
          const { messages, ...rest } = session;
          // debugLog("PERSIST", "处理会话持久化", {
          //   sessionId: session.id,
          //   title: session.title,
          //   messageCount: session.messageCount,
          //   messagesLength: messages?.length || 0,
          //   groupId: session.groupId,
          // });
          return { ...rest, messages: [] }; // 保持结构但清空messages
        }),
        // 清空 groupSessions 中所有会话的 messages
        groupSessions: Object.keys(state.groupSessions).reduce(
          (acc, sessionId) => {
            const session = state.groupSessions[sessionId];
            const { messages, ...rest } = session;
            // debugLog("PERSIST", "处理组内会话持久化", {
            //   sessionId,
            //   title: session.title,
            //   messageCount: session.messageCount,
            //   messagesLength: messages?.length || 0,
            //   groupId: session.groupId,
            // });
            acc[sessionId] = { ...rest, messages: [] };
            return acc;
          },
          {} as GroupSession,
        ),
      };

      debugLog("PERSIST", "状态持久化完成", {
        persistedSessionsCount: stateToPersist.sessions.length,
        persistedGroupsCount: stateToPersist.groups.length,
        persistedGroupSessionsCount: Object.keys(stateToPersist.groupSessions)
          .length,
      });

      return stateToPersist as any; // 使用 any 类型避免复杂的类型推断问题
    },

    /**
     * **核心改动：在数据恢复后安全加载当前会话的消息**
     * 这个钩子在状态从 storage 成功恢复（rehydrated）后触发
     */
    onRehydrateStorage: () => {
      debugLog("REHYDRATE", "onRehydrateStorage 钩子被调用");

      // 重置启动状态
      resetStartupState();

      return (hydratedState, error) => {
        // 标记数据已恢复
        setGlobalDataRestoredFlag(true);
        debugLog("REHYDRATE", "开始状态恢复", {
          hasError: !!error,
          errorMessage: error instanceof Error ? error.message : String(error),
          hydratedStateExists: !!hydratedState,
          hydratedSessionsCount: hydratedState?.sessions?.length || 0,
          hydratedGroupsCount: hydratedState?.groups?.length || 0,
          hydratedCurrentSessionIndex: hydratedState?.currentSessionIndex,
          hydratedCurrentGroupIndex: hydratedState?.currentGroupIndex,
          hydratedChatListView: hydratedState?.chatListView,
          timestamp: Date.now(),
          documentReadyState:
            typeof document !== "undefined" ? document.readyState : "unknown",
          performanceTiming:
            typeof performance !== "undefined" ? performance.now() : 0,
        });

        if (error) {
          debugLog("REHYDRATE", "❌ 状态恢复失败", {
            error: error instanceof Error ? error.message : String(error),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          console.error("[Store] An error happened during hydration", error);

          // 直接刷新页面
          if (typeof window !== "undefined") {
            window.location.reload();
          }
          // 不要设置 isHydrated = true
          return;

          // 即使 hydration 失败，也要设置 hydrated 状态，避免无限等待
          isHydrated = true;
          startupState.hydrationCompleted = true;
          // startupState.lastError =
          //   error instanceof Error ? error : new Error(String(error));

          // 安全地执行所有回调
          const callbackCount = hydrationCallbacks.length;
          debugLog("REHYDRATE", "执行错误状态下的回调", { callbackCount });

          hydrationCallbacks.forEach((callback, index) => {
            try {
              callback();
            } catch (callbackError) {
              debugLog("REHYDRATE", `回调 ${index} 执行失败`, {
                error:
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError),
              });
              console.error(
                "[Store] Error in hydration callback:",
                callbackError,
              );
            }
          });
          hydrationCallbacks.length = 0;
        } else {
          debugLog("REHYDRATE", "✅ 状态恢复成功，开始后续处理", {
            callbackCount: hydrationCallbacks.length,
            isClientSide: typeof window !== "undefined",
            hasHydratedState: !!hydratedState,
            hydratedStatePreview: hydratedState
              ? {
                  sessionsCount: hydratedState.sessions?.length || 0,
                  groupsCount: hydratedState.groups?.length || 0,
                  currentSessionIndex: hydratedState.currentSessionIndex,
                  currentGroupIndex: hydratedState.currentGroupIndex,
                  chatListView: hydratedState.chatListView,
                }
              : null,
          });

          // 设置全局 hydration 状态
          isHydrated = true;
          startupState.hydrationCompleted = true;

          // 验证恢复的数据结构
          if (hydratedState) {
            debugLog("REHYDRATE", "验证恢复的数据结构", {
              hasSessions: Array.isArray(hydratedState.sessions),
              hasGroups: Array.isArray(hydratedState.groups),
              hasGroupSessions: typeof hydratedState.groupSessions === "object",
              currentSessionIndexValid:
                typeof hydratedState.currentSessionIndex === "number" &&
                hydratedState.currentSessionIndex >= 0 &&
                hydratedState.currentSessionIndex <
                  (hydratedState.sessions?.length || 0),
              currentGroupIndexValid:
                typeof hydratedState.currentGroupIndex === "number" &&
                hydratedState.currentGroupIndex >= 0 &&
                hydratedState.currentGroupIndex <
                  (hydratedState.groups?.length || 0),
            });
          }

          // 安全地执行所有回调
          const callbackCount = hydrationCallbacks.length;
          debugLog("REHYDRATE", "执行成功状态下的回调", { callbackCount });

          hydrationCallbacks.forEach((callback, index) => {
            try {
              callback();
            } catch (callbackError) {
              debugLog("REHYDRATE", `回调 ${index} 执行失败`, {
                error:
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError),
              });
              console.error(
                "[Store] Error in hydration callback:",
                callbackError,
              );
            }
          });
          hydrationCallbacks.length = 0; // 清空回调数组

          // 只在客户端环境下执行应用准备流程
          if (typeof window !== "undefined") {
            debugLog("REHYDRATE", "开始客户端应用准备流程", {
              isClientSide: true,
              windowExists: typeof window !== "undefined",
              documentExists: typeof document !== "undefined",
              readyState:
                typeof document !== "undefined"
                  ? document.readyState
                  : "unknown",
              performanceNow:
                typeof performance !== "undefined" ? performance.now() : 0,
            });

            // 🔥 新的应用准备流程：数据完整性优先，首屏启动延后
            const startAppReadyProcess = () => {
              debugLog("REHYDRATE", "开始应用准备流程", {
                currentTime: Date.now(),
                timeSinceStart: Date.now() - startupState.initStartTime,
                documentReadyState:
                  typeof document !== "undefined"
                    ? document.readyState
                    : "unknown",
              });

              // 使用新的 ensureAppReady 函数，确保数据完整性
              ensureAppReady()
                .then(() => {
                  debugLog("REHYDRATE", "✅ 应用准备流程完成");

                  // 验证最终状态
                  const finalState = useChatStore.getState();
                  const finalSession = finalState.currentSession();

                  debugLog("REHYDRATE", "最终状态验证", {
                    sessionId: finalSession?.id,
                    sessionTitle: finalSession?.title,
                    messageCount: finalSession?.messageCount,
                    messagesLength: finalSession?.messages?.length,
                    hasMessages: !!(
                      finalSession?.messages && finalSession.messages.length > 0
                    ),
                    totalInitTime: Date.now() - startupState.initStartTime,
                    appReady: isAppReady,
                    dataRestored: isDataRestored,
                    hydrated: isHydrated,
                  });

                  // 现在可以开始首屏渲染了
                  debugLog("REHYDRATE", "🎉 首屏渲染可以开始");
                })
                .catch((readyError) => {
                  debugLog("REHYDRATE", "❌ 应用准备流程失败", {
                    error:
                      readyError instanceof Error
                        ? readyError.message
                        : String(readyError),
                    errorType:
                      readyError instanceof Error
                        ? readyError.constructor.name
                        : typeof readyError,
                    stack:
                      readyError instanceof Error
                        ? readyError.stack
                        : undefined,
                  });

                  // 准备失败时的处理策略
                  if (
                    readyError instanceof Error &&
                    (readyError.message.includes("数据结构损坏") ||
                      readyError.message.includes("数据为空"))
                  ) {
                    debugLog("REHYDRATE", "数据损坏，刷新页面");
                    if (typeof window !== "undefined") {
                      window.location.reload();
                    }
                  } else {
                    // 其他错误，允许应用继续启动，但记录错误
                    console.warn(
                      "[Store] 应用准备失败，但允许应用继续启动:",
                      readyError,
                    );
                    startupState.lastError =
                      readyError instanceof Error
                        ? readyError
                        : new Error(String(readyError));
                  }
                });
            };

            // 🔥 改进时序控制：确保在合适的时机启动应用准备流程
            // 给 IndexedDB 和 Zustand 更多时间完成准备
            if (
              typeof document !== "undefined" &&
              document.readyState === "loading"
            ) {
              debugLog("REHYDRATE", "DOM 还在加载中，等待 DOMContentLoaded");
              document.addEventListener("DOMContentLoaded", () => {
                debugLog("REHYDRATE", "DOMContentLoaded 事件触发");
                // 增加延迟，确保 IndexedDB 和所有异步操作完成
                setTimeout(startAppReadyProcess, 300);
              });
            } else {
              // DOM 已加载，稍等片刻再启动应用准备流程
              debugLog("REHYDRATE", "DOM 已加载，稍后启动应用准备流程");
              setTimeout(startAppReadyProcess, 300);
            }
          } else {
            debugLog("REHYDRATE", "跳过客户端应用准备", {
              reason: "非客户端环境",
              isClientSide: false,
            });
          }
        }
      };
    },

    migrate(persistedState: any, version: number) {
      return persistedState;
    },
  },
);

// 添加 persist 机制的调试和监控
debugLog("PERSIST_DEBUG", "ChatStore 创建完成", {
  timestamp: Date.now(),
  storeExists: !!useChatStore,
  hasGetState: typeof useChatStore.getState === "function",
  hasSubscribe: typeof useChatStore.subscribe === "function",
  hasPersist: typeof useChatStore.persist === "function",
});

// 检查是否有 persist 相关的状态
if (typeof useChatStore.persist === "function") {
  debugLog("PERSIST_DEBUG", "检查 persist 状态", {
    hasRehydrated: (useChatStore.persist as any).hasHydrated?.(),
    persistOptions: (useChatStore.persist as any).getOptions?.(),
  });
}

// 监控应用准备状态，如果一定时间内没有完成，手动触发恢复
let appReadyTimeout: NodeJS.Timeout | null = null;
const APP_READY_TIMEOUT = 8000; // 8秒超时，给应用准备更多时间

const clearAppReadyTimeout = () => {
  if (appReadyTimeout) {
    clearTimeout(appReadyTimeout);
    appReadyTimeout = null;
    debugLog("PERSIST_DEBUG", "清除应用准备超时定时器");
  }
};

// 监听应用准备状态变化
const checkAppReadyStatus = () => {
  debugLog("PERSIST_DEBUG", "检查应用准备状态", {
    isAppReady: isAppReady,
    isDataRestored: isDataRestored,
    isHydrated: isHydrated,
    hasRehydrated:
      typeof useChatStore.persist === "function"
        ? (useChatStore.persist as any).hasHydrated?.()
        : false,
    timestamp: Date.now(),
  });

  if (isAppReady) {
    debugLog("PERSIST_DEBUG", "✅ 应用准备已完成");
    clearAppReadyTimeout();
    return;
  }

  // 如果超时还没有完成应用准备，强制刷新页面
  appReadyTimeout = setTimeout(() => {
    debugLog("PERSIST_DEBUG", "⚠️ 应用准备超时，即将刷新页面", {
      timeout: APP_READY_TIMEOUT,
      isAppReady: isAppReady,
      isDataRestored: isDataRestored,
      isHydrated: isHydrated,
      hasRehydrated:
        typeof useChatStore.persist === "function"
          ? (useChatStore.persist as any).hasHydrated?.()
          : false,
      timestamp: Date.now(),
    });

    // 应用准备超时，直接刷新页面
    debugLog("PERSIST_DEBUG", "应用准备超时，刷新页面");
    if (typeof window !== "undefined") {
      window.location.reload();
    }

    appReadyTimeout = null;
  }, APP_READY_TIMEOUT);
};

// 在适当的时机检查应用准备状态
if (typeof window !== "undefined") {
  // 等待一段时间后检查状态，给初始化更多时间
  setTimeout(checkAppReadyStatus, 500);

  // 如果文档还在加载，等待完成后再检查
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(checkAppReadyStatus, 500);
    });
  }
}

// 添加状态诊断函数
const diagnoseStoreState = () => {
  const state = useChatStore.getState();
  const currentSession = state.currentSession();

  const diagnosis = {
    timestamp: Date.now(),
    startup: {
      isInitialized: startupState.isInitialized,
      hydrationCompleted: startupState.hydrationCompleted,
      firstDataLoad: startupState.firstDataLoad,
      hasError: !!startupState.lastError,
      lastError: startupState.lastError?.message,
      totalInitTime: startupState.initEndTime - startupState.initStartTime,
    },
    storage: {
      isHydrated: isHydrated,
      isInitializing: isInitializing,
      hasInitPromise: !!initializationPromise,
    },
    sessions: {
      total: state.sessions.length,
      currentIndex: state.currentSessionIndex,
      currentId: currentSession?.id,
      currentTitle: currentSession?.title,
      currentMessageCount: currentSession?.messageCount,
      currentMessagesLength: currentSession?.messages?.length,
      hasMessages: !!(
        currentSession?.messages && currentSession.messages.length > 0
      ),
      messageLoadNeeded: !!(
        currentSession &&
        currentSession.messageCount > 0 &&
        (!currentSession.messages || currentSession.messages.length === 0)
      ),
    },
    groups: {
      total: state.groups.length,
      currentIndex: state.currentGroupIndex,
      groupSessionsCount: Object.keys(state.groupSessions).length,
    },
    view: {
      chatListView: state.chatListView,
      chatListGroupView: state.chatListGroupView,
    },
    issues: [] as string[],
  };

  // 检查常见问题
  if (!diagnosis.startup.isInitialized) {
    diagnosis.issues.push("应用未完成初始化");
  }

  if (!diagnosis.startup.hydrationCompleted) {
    diagnosis.issues.push("状态恢复未完成");
  }

  if (diagnosis.sessions.messageLoadNeeded) {
    diagnosis.issues.push("当前会话消息未加载");
  }

  if (diagnosis.sessions.currentIndex >= diagnosis.sessions.total) {
    diagnosis.issues.push("当前会话索引超出范围");
  }

  if (diagnosis.startup.hasError) {
    diagnosis.issues.push(`启动错误: ${diagnosis.startup.lastError}`);
  }

  return diagnosis;
};

// 添加数据恢复函数
const attemptDataRecovery = async () => {
  debugLog("RECOVERY", "开始数据恢复", { timestamp: Date.now() });

  try {
    const state = useChatStore.getState();
    const currentSession = state.currentSession();

    if (!currentSession) {
      debugLog("RECOVERY", "当前会话不存在，创建默认会话");
      await state.newSession();
      return true;
    }

    // 检查消息加载状态
    const needsMessageLoad =
      currentSession.messageCount > 0 &&
      (!currentSession.messages || currentSession.messages.length === 0);

    if (needsMessageLoad) {
      debugLog("RECOVERY", "尝试重新加载消息", {
        sessionId: currentSession.id,
        messageCount: currentSession.messageCount,
        groupId: currentSession.groupId,
      });

      if (currentSession.groupId) {
        await state.loadGroupSessionMessages(currentSession.id);
      } else {
        await state.loadSessionMessages(state.currentSessionIndex);
      }

      // 验证恢复结果
      const recoveredSession = useChatStore.getState().currentSession();
      const recoverySuccess = !!(
        recoveredSession?.messages && recoveredSession.messages.length > 0
      );

      debugLog("RECOVERY", "数据恢复结果", {
        sessionId: recoveredSession?.id,
        recoverySuccess,
        recoveredMessages: recoveredSession?.messages?.length || 0,
      });

      return recoverySuccess;
    }

    debugLog("RECOVERY", "无需数据恢复", {
      sessionId: currentSession.id,
      hasMessages: !!(
        currentSession.messages && currentSession.messages.length > 0
      ),
    });

    return true;
  } catch (error) {
    debugLog("RECOVERY", "数据恢复失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("[ChatStore] 数据恢复失败:", error);
    return false;
  }
};

// 添加全局错误处理和诊断
const handleStartupIssues = async () => {
  const diagnosis = diagnoseStoreState();

  debugLog("DIAGNOSIS", "状态诊断结果", diagnosis);

  // 如果有问题，尝试恢复
  if (diagnosis.issues.length > 0) {
    debugLog("DIAGNOSIS", "发现问题，尝试自动恢复", {
      issues: diagnosis.issues,
      willAttemptRecovery: true,
    });

    const recoverySuccess = await attemptDataRecovery();

    if (recoverySuccess) {
      debugLog("DIAGNOSIS", "✅ 自动恢复成功");
      // 重新诊断以确认恢复效果
      const postRecoveryDiagnosis = diagnoseStoreState();
      debugLog("DIAGNOSIS", "恢复后状态", postRecoveryDiagnosis);
    } else {
      debugLog("DIAGNOSIS", "❌ 自动恢复失败");
    }

    return recoverySuccess;
  }

  return true;
};
