import type { ClientApi, MultimodalContent } from "../client/api";
import { getClientApi, getHeaders } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  StoreKey,
  SESSION_PAGE_SIZE,
  SESSION_INITIAL_LOAD_COUNT,
} from "../constant";
import Locale from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore, jchatStorage } from "../utils/store";
import { chatInputStorage } from "./input";
import { storageManager } from "../utils/storage-manager";
import { appReadyManager } from "../utils/app-ready-manager";
import { uploadImage } from "../utils/chat";
import { isImageFileLike, isTextFileLike } from "../utils/file-drop";
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
} from "../utils/session";
import { logger, createModuleLogger } from "../utils/logger";
import { parseGroupMessageId } from "../utils/group";
import { calculateGroupStatus } from "../utils/group";
import { determineModelForGroupSession } from "../utils/model";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

// 全局 hydration 状态管理
let isHydrated = false;
const hydrationCallbacks: (() => void)[] = [];

// 数据恢复状态管理（失败时强制刷新页面）
let isDataRestored = false;
let dataRestorationPromise: Promise<void> | null = null;
const DATA_RESTORATION_TIMEOUT = 10000; // 增加到10秒超时，给数据恢复更多时间

// 应用准备状态管理已移至 app-ready-manager.ts

// 设置全局状态标记供其他模块使用
const setGlobalDataRestoredFlag = (restored: boolean) => {
  isDataRestored = restored;
  if (typeof window !== "undefined") {
    (window as any).__jchat_data_restored = restored;
  }
};

// 全局应用准备标记已移至 app-ready-manager.ts

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
      const health = await storageManager.quickHealthCheck();
      if (health.status === "unavailable") {
        throw new Error("存储系统不可用");
      }

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

      // 如果 persist 没有完成 rehydration，等待它完成
      debugLog("FORCE_RESTORE", "Persist 未完成 rehydration，等待完成", {
        currentUrl:
          typeof window !== "undefined" ? window.location.href : "unknown",
        waitingForRehydration: true,
        timestamp: Date.now(),
      });

      // 等待 rehydration 完成，最多等待 10 秒
      const maxWaitTime = 10000; // 10秒
      const checkInterval = 100; // 100ms 检查一次
      let waitedTime = 0;

      while (waitedTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        waitedTime += checkInterval;

        const hasRehydrated = (useChatStore.persist as any).hasHydrated?.();
        if (hasRehydrated) {
          debugLog("FORCE_RESTORE", "Persist rehydration 完成", {
            waitedTime,
            timestamp: Date.now(),
          });
          isHydrated = true;
          setGlobalDataRestoredFlag(true);
          return;
        }
      }

      // 如果等待超时，记录警告但不刷新页面
      debugLog("FORCE_RESTORE", "等待 rehydration 超时，继续运行", {
        waitedTime,
        maxWaitTime,
        timestamp: Date.now(),
      });

      // 即使超时也设置数据恢复标志，避免无限循环
      isHydrated = true;
      setGlobalDataRestoredFlag(true);
    } catch (error) {
      debugLog("FORCE_RESTORE", "数据恢复检查失败，继续运行", {
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });

      // 即使出错也设置数据恢复标志，避免无限循环
      isHydrated = true;
      setGlobalDataRestoredFlag(true);
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
      debugLog("ENSURE_RESTORE", "数据恢复超时，继续运行");
      // 即使超时也设置数据恢复标志，避免无限循环
      setGlobalDataRestoredFlag(true);
      resolve();
    }, DATA_RESTORATION_TIMEOUT);

    forceDataRestoration()
      .then(() => {
        clearTimeout(timeoutId);
        resolve();
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        debugLog("ENSURE_RESTORE", "数据恢复失败，继续运行", {
          error: error instanceof Error ? error.message : String(error),
        });
        // 即使失败也设置数据恢复标志，避免无限循环
        setGlobalDataRestoredFlag(true);
        resolve();
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

  // debugLog("STORAGE_RETRY", "开始存储操作", {
  //   maxRetries,
  //   delay,
  //   timeout: RETRY_CONFIG.storageTimeout,
  //   stackTrace: new Error().stack?.split("\n")[2]?.trim(), // 添加调用栈信息
  // });

  for (let i = 0; i < maxRetries; i++) {
    try {
      // debugLog("STORAGE_RETRY", `尝试存储操作 ${i + 1}/${maxRetries}`, {
      //   attempt: i + 1,
      //   isFirstAttempt: i === 0,
      //   previousError: lastError?.message,
      // });

      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Storage operation timeout")),
            RETRY_CONFIG.storageTimeout,
          ),
        ),
      ]);

      // debugLog("STORAGE_RETRY", "存储操作成功", {
      //   attempt: i + 1,
      //   hasResult: !!result,
      //   resultType: typeof result,
      //   resultPreview: Array.isArray(result)
      //     ? `Array(${result.length})`
      //     : result,
      // });

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

// 存储准备就绪检查已移至 storage-manager.ts

// 移除全局存储健康状态跟踪，现在总是尝试访问存储

export function isStoreHydrated(): boolean {
  return isHydrated;
}

export function isStoreDataRestored(): boolean {
  return isDataRestored;
}

export function isAppReadyState(): boolean {
  return appReadyManager.isReady();
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
  return appReadyManager.waitForReady();
}

// 应用准备管理已移至 app-ready-manager.ts
// 这里提供数据验证函数供新管理器使用
async function validateChatStoreData(): Promise<void> {
  const state = useChatStore.getState();

  // 验证基本数据结构
  if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
    throw new Error("会话数据无效");
  }

  // 使用统一存储管理器验证数据一致性
  const { valid, fixes } = await storageManager.validateDataConsistency(state);
  if (!valid) {
    throw new Error("数据一致性验证失败");
  }

  if (fixes.length > 0) {
    // console.log("[ChatStore] 数据修复:", fixes);
  }

  // 确保当前会话数据完整
  await ensureCurrentSessionDataComplete();
}

// 旧的 validateDataIntegrity 已合并到 validateChatStoreData

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

// 创建聊天模块日志器 - 自动检测 NEXT_PUBLIC_DEBUG_CHAT 环境变量
const chatLogger = createModuleLogger("CHAT");

const syncLogger = createModuleLogger("SYNC");

// 使用新的高级日志系统
const debugLog = (category: string, message: string, data?: any) => {
  chatLogger.debug(category, message, data);
};

const syncDebugLog = (category: string, message: string, data?: any) => {
  syncLogger.debug(category, message, data);
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

export interface ChatSession {
  id: string;
  title: string;
  sourceName?: string; // 表示生成该会话的源文件名，可选
  model: string; // 当前会话选择的模型
  messageCount: number; // 消息数量
  status: "normal" | "error" | "pending"; // 会话状态：正常、错误、用户消息结尾
  isModelManuallySelected?: boolean; // 用户是否手动选择了模型（用于自动切换逻辑）
  longInputMode?: boolean; // 是否为长输入模式（Enter 换行，Ctrl+Enter 发送）
  ignoreSystemPrompt?: boolean; // 是否忽略系统提示词（仅在组会话模式下有效）
  useMemory?: boolean; // 是否启用用户记忆（仅普通会话有效，组会话不使用）
  isTitleManuallyEdited?: boolean; // 用户是否手动编辑过标题（用于生成标题时的确认提示）
  groupId: string | null;
  lastUpdate: number;
  messages: ChatMessage[];
  // 新增：滚动状态和分片管理
  scrollState?: {
    scrollTop: number; // 滚动位置
    messageIndex: number; // 当前可见的第一个消息索引
    viewportHeight: number; // 视口高度，用于精确恢复
    lastUpdated: number; // 最后更新时间戳
  };
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
  longTextModel: null as string | null,
  groupSessionModel: null as string | null,
  defaultModel: null as string | null,
  configError: null as string | null,
  fetchState: 0 as number, // 0 not fetch, 1 fetching, 2 done
  accessCode: "",
  mem0_user_id: "", // Mem0 用户记忆 ID，设置页配置；空则不启用
  batchApplyMode: false, // 批量应用模式
  activeBatchRequests: 0, // 活跃的批量请求计数器
  mobileViewState: "sidebar" as "sidebar" | "chat" | "settings", // 移动端界面状态
  exportFormat: "image" as string, // 导出格式配置
  expandMetrics: true, // 全局指标展开设置
  // --- Sidebar scroll states ---
  sidebarScrollPosition: 0, // 侧边栏当前滚动位置（即时值）
  sidebarScrollHistory: {} as Record<string, number>, // 不同列表视图的滚动位置缓存
  // --- Session pagination states ---
  sessionPagination: {
    pageSize: SESSION_PAGE_SIZE,
    loadedCount: SESSION_INITIAL_LOAD_COUNT,
    isLoading: false,
    hasMore: true,
  },
  // --- Session merge (仅普通会话) ---
  mergeMode: false,
  selectedSessionIdsForMerge: [] as string[],
  mergeOrderSessionIds: [] as string[],
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

      // 全局指标展开设置
      setExpandMetrics(expanded: boolean): void {
        set({ expandMetrics: expanded });
      },

      // 用户记忆（Mem0）：设置页配置的 mem0_user_id
      setMem0UserId(value: string): void {
        set({ mem0_user_id: value ?? "" });
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

      // --- Sidebar scroll helpers ---
      setSidebarScrollPosition(scrollTop: number): void {
        // 仅记录有效数值
        if (
          typeof scrollTop === "number" &&
          scrollTop >= 0 &&
          !isNaN(scrollTop)
        ) {
          set({ sidebarScrollPosition: scrollTop });
        }
      },

      saveSidebarScrollPosition(key: string, scrollTop: number): void {
        if (!key) return;
        if (
          typeof scrollTop !== "number" ||
          isNaN(scrollTop) ||
          scrollTop < 0
        ) {
          return;
        }

        set((state) => ({
          sidebarScrollHistory: {
            ...state.sidebarScrollHistory,
            [key]: scrollTop,
          },
        }));
      },

      // --- 新增：会话滚动状态管理方法 ---

      getSidebarScrollPosition(key: string): number {
        if (!key) return 0;
        const history = get().sidebarScrollHistory as Record<string, number>;
        const val = history?.[key];
        return typeof val === "number" && !isNaN(val) && val >= 0 ? val : 0;
      },

      clearSidebarScrollHistory(): void {
        set({ sidebarScrollHistory: {} });
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
              // 🔧 先同步更新基础 messageCount，后续异步更新包含系统提示词的完整统计
              targetSession.messageCount = messages.length;
              // debugLog("LOAD", "设置加载的消息", {
              //   sessionId: session.id,
              //   messagesCount: messages.length,
              //   messageIds: messages.map((m) => m.id),
              //   messageRoles: messages.map((m) => m.role),
              //   totalMessageLength: messages.reduce(
              //     (sum, m) =>
              //       sum +
              //       (typeof m.content === "string" ? m.content.length : 0),
              //     0,
              //   ),
              // });
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

          // 🔧 修复：异步更新包含系统提示词的完整统计信息
          const finalSession = get().sessions[sessionIndex];
          if (finalSession) {
            await updateSessionStats(finalSession);
            // 强制更新UI以显示正确的消息计数
            set((state) => {
              const newSessions = [...state.sessions];
              newSessions[sessionIndex] = { ...finalSession };
              return { sessions: newSessions };
            });
          }

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
        // 新建会话时允许保存，避免死锁
        if (!isDataRestored && !force) {
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

          await messageStorage.save(session.id, messagesToSave, force);
        } catch (error) {
          console.error(
            `[ChatStore] Failed to save messages for session ${session.id}`,
            error,
          );
        }
      },

      // 优化：会话切换时的清理
      async selectSession(index: number) {
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

        const targetSession = get().sessions[index];
        const needsMessageLoad =
          targetSession?.messageCount > 0 &&
          (!targetSession?.messages || targetSession.messages.length === 0);

        // 🔧 修复竞态条件：如果需要加载消息，先加载再更新UI
        if (needsMessageLoad) {
          try {
            await get().loadSessionMessages(index);
          } catch (error) {
            console.error("[selectSession] 消息加载失败", error);
          }
        }

        // 更新UI状态（此时消息已加载完成或本来就存在）
        set((state) => ({
          currentSessionIndex: index,
          chatListView: "sessions",
        }));
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
        setTimeout(async () => {
          await get().loadGroupSessionMessages(sessionId);
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

      /** 通过分享链接无损载入会话：当前为空则覆盖当前会话，否则新建会话并载入 */
      async loadShareByLink(
        shareId: string,
      ): Promise<{ ok: boolean; error?: string }> {
        if (!isDataRestored) {
          return { ok: false, error: "数据未恢复，请稍后再试" };
        }
        const state = get();
        if (state.chatListView !== "sessions") {
          return { ok: false, error: "请切换到普通会话列表后再载入分享链接" };
        }
        let res: Response;
        try {
          res = await fetch(`/api/share/${shareId}`);
        } catch (e) {
          return { ok: false, error: "网络错误，载入失败" };
        }
        if (!res.ok) {
          const msg = res.status === 404 ? "分享不存在或已失效" : "载入失败";
          return { ok: false, error: msg };
        }
        let body: {
          version?: number;
          session?: Record<string, unknown>;
          systemPrompt?: { text: string; images: string[] };
          title?: string;
          messages?: unknown[];
        };
        try {
          body = await res.json();
        } catch {
          return { ok: false, error: "数据格式异常" };
        }
        const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
        const normalizedMessages: ChatMessage[] = messagesRaw.map((m: any) => ({
          ...m,
          id: m.id ?? nanoid(),
          role: m.role ?? "user",
          content: m.content ?? "",
          date:
            typeof m.date === "string"
              ? m.date
              : m.date
                ? new Date(m.date).toLocaleString()
                : new Date().toLocaleString(),
        }));

        const meta =
          body.session && typeof body.session === "object"
            ? body.session
            : null;
        const legacyTitle =
          typeof body.title === "string" ? body.title.trim() : undefined;
        const systemPromptPayload =
          body.systemPrompt &&
          typeof body.systemPrompt === "object" &&
          (typeof body.systemPrompt.text === "string" ||
            Array.isArray(body.systemPrompt.images))
            ? body.systemPrompt
            : null;

        const currentSession = get().currentSession();
        const isEmpty =
          currentSession &&
          currentSession.messages.length === 0 &&
          currentSession.title === Locale.Session.Title.Default;

        let targetSession: ChatSession;
        if (isEmpty && currentSession) {
          targetSession = currentSession;
          get().updateSession(targetSession, (s) => {
            s.messages = normalizedMessages;
            s.messageCount = normalizedMessages.length;
            s.lastUpdate = Date.now();
            s.title = (meta?.title as string) ?? legacyTitle ?? s.title;
            if (typeof meta?.model === "string") s.model = meta.model;
            if (typeof meta?.longInputMode === "boolean")
              s.longInputMode = meta.longInputMode;
            if (typeof meta?.ignoreSystemPrompt === "boolean")
              s.ignoreSystemPrompt = meta.ignoreSystemPrompt;
            if (typeof meta?.useMemory === "boolean")
              s.useMemory = meta.useMemory;
            if (typeof meta?.isTitleManuallyEdited === "boolean")
              s.isTitleManuallyEdited = meta.isTitleManuallyEdited;
            if (
              typeof meta?.status === "string" &&
              ["normal", "error", "pending"].includes(meta.status)
            )
              s.status = meta.status as "normal" | "error" | "pending";
            if (typeof meta?.isModelManuallySelected === "boolean")
              s.isModelManuallySelected = meta.isModelManuallySelected;
            if (typeof meta?.sourceName === "string")
              s.sourceName = meta.sourceName;
          });
        } else {
          // 当前会话非空：新建会话并直接写入分享数据，不调用 newSession()，
          // 避免 newSession() 内部 loadSessionMessages(0) 从 storage 拉空数据覆盖
          const newSession = createEmptySession();
          newSession.messages = normalizedMessages;
          newSession.messageCount = normalizedMessages.length;
          newSession.lastUpdate = Date.now();
          newSession.title =
            (meta?.title as string) ?? legacyTitle ?? newSession.title;
          if (typeof meta?.model === "string") newSession.model = meta.model;
          if (typeof meta?.longInputMode === "boolean")
            newSession.longInputMode = meta.longInputMode;
          if (typeof meta?.ignoreSystemPrompt === "boolean")
            newSession.ignoreSystemPrompt = meta.ignoreSystemPrompt;
          if (typeof meta?.useMemory === "boolean")
            newSession.useMemory = meta.useMemory;
          if (typeof meta?.isTitleManuallyEdited === "boolean")
            newSession.isTitleManuallyEdited = meta.isTitleManuallyEdited;
          if (
            typeof meta?.status === "string" &&
            ["normal", "error", "pending"].includes(meta.status)
          )
            newSession.status = meta.status as "normal" | "error" | "pending";
          if (typeof meta?.isModelManuallySelected === "boolean")
            newSession.isModelManuallySelected = meta.isModelManuallySelected;
          if (typeof meta?.sourceName === "string")
            newSession.sourceName = meta.sourceName;

          set((state) => {
            const newSessions = [newSession].concat(state.sessions);
            const { sessionPagination } = state;
            const newLoadedCount = Math.min(
              sessionPagination.loadedCount + 1,
              newSessions.length,
            );
            return {
              currentSessionIndex: 0,
              sessions: newSessions,
              chatListView: "sessions",
              sessionPagination: {
                ...sessionPagination,
                loadedCount: newLoadedCount,
                hasMore: newLoadedCount < newSessions.length,
              },
            };
          });
          targetSession = newSession;
        }

        const sessionId = targetSession.id;
        if (systemPromptPayload) {
          try {
            await systemMessageStorage.save(sessionId, {
              text:
                typeof systemPromptPayload.text === "string"
                  ? systemPromptPayload.text
                  : "",
              images: Array.isArray(systemPromptPayload.images)
                ? systemPromptPayload.images
                : [],
              scrollTop: 0,
              selection: { start: 0, end: 0 },
              updateAt: Date.now(),
            });
          } catch (e) {
            console.error("[loadShareByLink] 保存系统提示词失败", e);
          }
        }

        try {
          await get().saveSessionMessages(targetSession, true);
        } catch (e) {
          console.error("[loadShareByLink] 保存消息失败", e);
        }
        return { ok: true };
      },

      async newSession() {
        const session = createEmptySession();

        debugLog("NEW_SESSION", "开始创建新会话", {
          sessionId: session.id,
          sessionTitle: session.title,
          currentSessionsCount: get().sessions.length,
        });

        // 总是尝试保存消息，不依赖存储健康状态
        try {
          await get().saveSessionMessages(session, true); // 强制保存，避免死锁
          debugLog("NEW_SESSION", "会话消息保存成功", {
            sessionId: session.id,
          });
        } catch (error) {
          console.error("[ChatStore] 保存会话消息失败:", error);
          debugLog("NEW_SESSION", "会话消息保存失败", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // 即使保存失败，也继续创建会话
        }

        const oldSessions = get().sessions;
        debugLog("NEW_SESSION", "更新前状态", {
          oldSessionsCount: oldSessions.length,
          newSessionId: session.id,
        });

        set((state) => {
          const newSessions = [session].concat(state.sessions);
          debugLog("NEW_SESSION", "更新后状态", {
            newSessionsCount: newSessions.length,
            currentSessionIndex: 0,
          });

          // 新会话添加到开头，已加载数量需要增加1
          const { sessionPagination } = state;
          const newLoadedCount = Math.min(
            sessionPagination.loadedCount + 1,
            newSessions.length,
          );

          return {
            currentSessionIndex: 0,
            sessions: newSessions,
            sessionPagination: {
              ...sessionPagination,
              loadedCount: newLoadedCount,
              hasMore: newLoadedCount < newSessions.length,
            },
          };
        });

        // 总是尝试加载消息，不依赖存储健康状态
        try {
          await get().loadSessionMessages(0);
          debugLog("NEW_SESSION", "会话消息加载成功", {
            sessionId: session.id,
          });
        } catch (error) {
          console.error("[ChatStore] 加载会话消息失败:", error);
          debugLog("NEW_SESSION", "会话消息加载失败", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // 即使加载失败，也不影响会话创建
        }

        debugLog("NEW_SESSION", "新会话创建完成", {
          sessionId: session.id,
          finalSessionsCount: get().sessions.length,
        });
      },

      async newGroup(group: ChatGroup) {
        // 创建组内第一个会话
        const firstSession = createEmptySession();
        firstSession.groupId = group.id;
        firstSession.title = group.title;

        // 为组会话设置默认模型和长文本模式
        const state = get();
        firstSession.model = determineModelForGroupSession(
          state.groupSessionModel,
          state.defaultModel as string,
        );
        firstSession.longInputMode = true;
        firstSession.isModelManuallySelected = false;

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
      async newGroupSession(title?: string) {
        const { groups, currentGroupIndex, groupSessions } = get();
        const currentGroup = groups[currentGroupIndex];

        if (!currentGroup) {
          // console.warn("[ChatStore] No current group found");
          return;
        }

        // 创建新的组内会话
        const newSession = createEmptySession();
        newSession.groupId = currentGroup.id;
        // 如果传入了标题（如文件名），直接使用；否则使用默认标题
        newSession.title = title || Locale.Session.Title.DefaultGroup;

        // 为组会话设置默认模型和长文本模式
        const state = get();
        newSession.model = determineModelForGroupSession(
          state.groupSessionModel,
          state.defaultModel as string,
        );
        newSession.longInputMode = true;
        newSession.isModelManuallySelected = false;

        // 保存会话消息
        await get().saveSessionMessages(newSession, true); // 强制保存，避免死锁

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

        // 切换到会话模式时，重置分页状态
        if (mode === "sessions") {
          get().resetSessionPagination();
        }

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
          // console.warn(`[ChatStore] Group session ${sessionId} not found`);
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
            // console.warn(
            //   `[ChatStore] 组会话 ${sessionId} 显示有 ${session.messageCount} 条消息，但加载为空`,
            // );
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
          // console.warn(`[ChatStore] No current group found`);
          return;
        }

        const sessionIndex = currentGroup.sessionIds.indexOf(sessionId);
        if (sessionIndex === -1) {
          // console.warn(
          //   `[ChatStore] Session ${sessionId} not found in current group`,
          // );
          return;
        }

        const deletedSession = groupSessions[sessionId];
        if (!deletedSession) {
          // console.warn(
          //   `[ChatStore] Group session ${sessionId} not found in groupSessions`,
          // );
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

          // 为组会话设置默认模型和长文本模式
          const state = get();
          newSessionToAdd.model = determineModelForGroupSession(
            state.groupSessionModel,
            state.defaultModel as string,
          );
          newSessionToAdd.longInputMode = true;
          newSessionToAdd.isModelManuallySelected = false;

          // 保存会话消息
          await get().saveSessionMessages(newSessionToAdd, true); // 强制保存，避免死锁

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
        await get().saveSessionMessages(newSession, true); // 强制保存，避免死锁

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

        // 🔧 修复：确保消息在状态更新前就完全准备好
        // 直接设置消息，避免异步加载导致的竞态条件
        newSession.messages = messagesToCopy;
        newSession.messageCount = messagesToCopy.length;

        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionIndex: 0, // 切换到新创建的分支会话
        }));

        // 移除不必要的消息加载，因为消息已经在状态更新前设置好了
        // await get().loadSessionMessages(0);

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

      async nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        await get().selectSession(limit(i + delta));
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
          await get().saveSessionMessages(newSession, true); // 强制保存，避免死锁
        }

        // 立即更新UI状态（从sessions数组中移除）
        set((state) => {
          const { sessionPagination } = state;
          // 如果删除后总数少于已加载数量，需要调整
          const newLoadedCount = Math.min(
            sessionPagination.loadedCount,
            sessions.length,
          );

          return {
            currentSessionIndex: nextIndex,
            sessions,
            sessionPagination: {
              ...sessionPagination,
              loadedCount: newLoadedCount,
              hasMore: newLoadedCount < sessions.length,
            },
          };
        });

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
                // console.warn(
                //   `[ChatStore] Group session ${currentSessionId} not found in groupSessions`,
                // );
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
                // console.warn(
                //   `[ChatStore] Group session ${firstSessionId} not found in groupSessions`,
                // );
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
        // 处理最终的 usage 信息
        if (usage && message.role === "assistant") {
          if (usage.prompt_tokens) {
            message.prompt_tokens = usage.prompt_tokens;
          }
          if (usage.completion_tokens) {
            message.completion_tokens = usage.completion_tokens;
          }
          if (usage.cost) {
            message.cost = usage.cost;
          }

          // 最终计算 tps
          if (message.completion_tokens && message.total_time && message.ttft) {
            const effectiveTime = message.total_time - message.ttft;
            if (effectiveTime > 0) {
              message.tps = Math.round(
                message.completion_tokens / effectiveTime,
              );
            }
          }
        }

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
          !!session.groupId, // 强制指定是否为组内会话消息
        );

        const modelMessage = createMessage(
          {
            role: "assistant",
            content: "",
            streaming: true,
            model: session.model,
          },
          finalModelBatchId,
          !!session.groupId, // 强制指定是否为组内会话消息
        );

        // 记录模型消息的开始时间，用于计算指标
        const startTime = Date.now();

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
        const mem0Id =
          !session.groupId &&
          (session.useMemory ?? false) &&
          get().mem0_user_id?.trim()
            ? get().mem0_user_id.trim()
            : undefined;
        // make request
        api.llm.chat({
          messages: sendMessages,
          model: session.model,
          ...(mem0Id ? { mem0_user_id: mem0Id } : {}),
          onUpdate(message, chunk, usage) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.content = message;
            }

            // 计算和更新模型回复指标
            const currentTime = Date.now();

            // 计算 ttft (time to first token) - 只在第一次有内容时设置
            if (!modelMessage.ttft && chunk && chunk.length > 0) {
              modelMessage.ttft =
                Math.round((currentTime - startTime) / 10) / 100; // 保留两位小数
            }

            // 更新 total_time
            modelMessage.total_time =
              Math.round((currentTime - startTime) / 10) / 100; // 保留两位小数

            // 从 usage 中更新 token 信息和 cost
            if (usage) {
              if (usage.prompt_tokens) {
                modelMessage.prompt_tokens = usage.prompt_tokens;
              }
              if (usage.completion_tokens) {
                modelMessage.completion_tokens = usage.completion_tokens;
              }
              if (usage.cost) {
                modelMessage.cost = usage.cost;
              }

              // 计算 tps (tokens per second)
              if (
                modelMessage.completion_tokens &&
                modelMessage.total_time &&
                modelMessage.ttft
              ) {
                const effectiveTime =
                  modelMessage.total_time - modelMessage.ttft;
                if (effectiveTime > 0) {
                  modelMessage.tps = Math.round(
                    modelMessage.completion_tokens / effectiveTime,
                  );
                }
              }
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
          onReasoningUpdate(message, chunk, usage) {
            modelMessage.streaming = true;
            if (message) {
              modelMessage.reasoningContent = message;
            }

            // 计算和更新模型回复指标
            const currentTime = Date.now();

            // 计算 ttft (time to first token) - 只在第一次有内容时设置
            if (!modelMessage.ttft && message && message.length > 0) {
              modelMessage.ttft =
                Math.round((currentTime - startTime) / 10) / 100; // 保留两位小数
            }

            // 更新 total_time
            modelMessage.total_time =
              Math.round((currentTime - startTime) / 10) / 100; // 保留两位小数

            // 从 usage 中更新 token 信息和 cost
            if (usage) {
              if (usage.prompt_tokens) {
                modelMessage.prompt_tokens = usage.prompt_tokens;
              }
              if (usage.completion_tokens) {
                modelMessage.completion_tokens = usage.completion_tokens;
              }
              if (usage.cost) {
                modelMessage.cost = usage.cost;
              }

              // 计算 tps (tokens per second)
              if (
                modelMessage.completion_tokens &&
                modelMessage.total_time &&
                modelMessage.ttft
              ) {
                const effectiveTime =
                  modelMessage.total_time - modelMessage.ttft;
                if (effectiveTime > 0) {
                  modelMessage.tps = Math.round(
                    modelMessage.completion_tokens / effectiveTime,
                  );
                }
              }
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

            // 🚀 Streaming 结束后直接广播新消息（延迟以确保状态已同步）
            setTimeout(() => {
              // 直接发送广播消息，不依赖状态变化检测
              if (broadcastChannel) {
                const message = {
                  type: "STATE_UPDATE_AVAILABLE",
                  payload: {
                    lastUpdate: Date.now(),
                    changeType: "messageUpdate", // 专门的消息更新类型
                    sessionId: session.id,
                  },
                };

                broadcastChannel.postMessage(message);
              }
            }, 100);
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
                // console.log("[onSendMessage] ❌ onError 保存消息", {
                //   sessionId: session.id,
                //   errorMessage: error.message,
                //   isAborted,
                //   userMessageError: userMessage.isError,
                //   modelMessageError: modelMessage.isError,
                //   latestMessageCount:
                //     latestSessionOnError.messages?.length || 0,
                //   step: "onError",
                // });

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
        // 若消息未加载则先加载：messageCount>0 表示应有消息，或用户主动点击「生成标题」时也尝试加载（避免 messageCount 未同步导致不加载）
        const messagesEmpty =
          !session.messages || session.messages.length === 0;
        const needsMessageLoad =
          (session.messageCount > 0 && messagesEmpty) ||
          (refreshTitle && messagesEmpty);

        if (needsMessageLoad) {
          debugLog("GENERATE_TITLE", "消息未加载，先加载消息", {
            sessionId: session.id,
            messageCount: session.messageCount,
            isGroupSession: !!session.groupId,
          });

          try {
            if (session.groupId) {
              await get().loadGroupSessionMessages(session.id);
            } else {
              // 对于普通会话，需要找到索引
              const sessionIndex = get().sessions.findIndex(
                (s) => s.id === session.id,
              );
              if (sessionIndex >= 0) {
                await get().loadSessionMessages(sessionIndex);
              }
            }

            // 重新获取会话对象（消息已加载）
            const updatedSession = session.groupId
              ? get().groupSessions[session.id]
              : get().sessions.find((s) => s.id === session.id);

            if (updatedSession) {
              session = updatedSession;
            }
          } catch (error) {
            console.error("加载消息失败:", error);
            debugLog("GENERATE_TITLE", "加载消息失败", {
              error: error instanceof Error ? error.message : String(error),
            });
            // 继续执行，即使加载失败也尝试生成标题
          }
        }

        await generateSessionTitle(session, refreshTitle, (newTitle) => {
          // 根据会话类型选择更新方法
          if (session.groupId) {
            get().updateGroupSession(
              session,
              (session) => {
                session.title = newTitle;
              },
              false, // 自动生成，设置 isTitleManuallyEdited = false
            );
          } else {
            get().updateSession(
              session,
              (session) => {
                session.title = newTitle;
              },
              false, // 自动生成，设置 isTitleManuallyEdited = false
            );
          }
        });
      },

      // 根据会话ID获取会话对象
      getSessionById(sessionId: string): ChatSession | null {
        const state = get();

        // 在普通会话中查找
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) return session;

        // 在组会话中查找
        const groupSession = state.groupSessions[sessionId];
        if (groupSession) return groupSession;

        return null;
      },

      // ---------- 会话合并（仅普通会话） ----------
      toggleMergeSelection(sessionId: string): void {
        const state = get();
        const current = state.sessions[state.currentSessionIndex];
        if (!current || current.groupId !== null) return; // 仅普通会话
        const session = state.sessions.find((s) => s.id === sessionId);
        if (!session || session.groupId !== null) return;

        const isCurrent = sessionId === current.id;
        if (isCurrent) return; // 当前会话始终参与，不通过 toggle 加入

        set((s) => {
          const next = s.selectedSessionIdsForMerge.includes(sessionId)
            ? s.selectedSessionIdsForMerge.filter((id) => id !== sessionId)
            : [...s.selectedSessionIdsForMerge, sessionId];
          const order = [current.id, ...next];
          return {
            selectedSessionIdsForMerge: next,
            mergeOrderSessionIds: order,
            mergeMode: order.length >= 2,
          };
        });
      },

      exitMergeMode(): void {
        set({
          mergeMode: false,
          selectedSessionIdsForMerge: [],
          mergeOrderSessionIds: [],
        });
      },

      reorderMergeOrder(fromIndex: number, toIndex: number): void {
        const state = get();
        if (state.mergeOrderSessionIds.length <= 1) return;
        const next = [...state.mergeOrderSessionIds];
        const [removed] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, removed);
        set({ mergeOrderSessionIds: next });
      },

      async mergeSessionsAndCreateNew(): Promise<void> {
        const state = get();
        const order = state.mergeOrderSessionIds;
        if (order.length < 2) return;

        const sessions = state.sessions;
        for (let i = 0; i < order.length; i++) {
          const idx = sessions.findIndex((s) => s.id === order[i]);
          if (idx >= 0) await get().loadSessionMessages(idx);
        }

        const mergedMessages: ChatMessage[] = [];
        for (const id of order) {
          const s = get().getSessionById(id);
          if (s && s.messages?.length) {
            const nonSystem = s.messages.filter(
              (m) => !m.isError && m.role !== "system",
            );
            mergedMessages.push(...nonSystem);
          }
        }

        const systemTexts: string[] = [];
        const systemImages: string[] = [];
        for (const id of order) {
          const data = await systemMessageStorage.get(id);
          if (data.text?.trim()) systemTexts.push(data.text.trim());
          if (data.images?.length) systemImages.push(...data.images);
        }
        const mergedSystemText =
          systemTexts.length > 0 ? systemTexts.join("\n\n---\n\n") : "";
        const mergedSystemImages = systemImages;

        const firstSession = get().getSessionById(order[0]);
        if (!firstSession) return;

        const newSession = createEmptySession();
        newSession.title = `${firstSession.title}等合并会话`;
        newSession.model = firstSession.model;
        newSession.longInputMode = firstSession.longInputMode;
        newSession.ignoreSystemPrompt = firstSession.ignoreSystemPrompt;
        newSession.useMemory = firstSession.useMemory ?? false;
        newSession.isModelManuallySelected =
          firstSession.isModelManuallySelected;
        newSession.messages = mergedMessages;
        newSession.messageCount = mergedMessages.length;
        updateSessionStatsBasic(newSession);

        try {
          await get().saveSessionMessages(newSession, true);
        } catch (e) {
          console.error("[mergeSessionsAndCreateNew] 保存消息失败", e);
        }
        await systemMessageStorage.save(newSession.id, {
          text: mergedSystemText,
          images: mergedSystemImages,
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        });

        set((s) => {
          const newSessions = [newSession].concat(s.sessions);
          const { sessionPagination } = s;
          const newLoadedCount = Math.min(
            sessionPagination.loadedCount + 1,
            newSessions.length,
          );
          return {
            sessions: newSessions,
            currentSessionIndex: 0,
            sessionPagination: {
              ...sessionPagination,
              loadedCount: newLoadedCount,
              hasMore: newLoadedCount < newSessions.length,
            },
            mergeMode: false,
            selectedSessionIdsForMerge: [],
            mergeOrderSessionIds: [],
          };
        });

        await get().loadSessionMessages(0);
        get().generateSessionTitle(true, get().currentSession());
      },

      updateSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
        isManualEdit?: boolean, // 新增：是否为手动编辑（用于设置 isTitleManuallyEdited 标志）
      ) {
        set((state) => {
          const index = state.sessions.findIndex((s) => s.id === session.id);
          if (index < 0) return {}; // 如果会话不存在，直接返回空对象
          const updatedSession = { ...state.sessions[index] }; // 修改浅拷贝
          updater(updatedSession); // 修改会话浅拷贝

          // 如果指定了 isManualEdit，设置 isTitleManuallyEdited 标志
          if (isManualEdit !== undefined) {
            updatedSession.isTitleManuallyEdited = isManualEdit;
          }

          const sessions = [...state.sessions]; // 会话数组浅拷贝
          sessions[index] = updatedSession; // 更新会话数组浅拷贝
          return { sessions }; // 返回包含新 sessions 数组的状态对象，Zustand 会将这个对象与当前状态合并，触发组件重新渲染
        });
      },

      // 更新组内会话并同步组标题和消息数量
      updateGroupSession(
        session: ChatSession,
        updater: (session: ChatSession) => void,
        isManualEdit?: boolean, // 新增：是否为手动编辑（用于设置 isTitleManuallyEdited 标志）
      ) {
        set((state) => {
          // 一定要以 groupSessions 里的最新对象为基础，防止被旧对象覆盖
          const baseSession = state.groupSessions[session.id] || session;
          const updatedSession = { ...baseSession };

          // 保存更新前的状态，用于计算状态变化
          const oldStatus = updatedSession.status;

          // 应用更新器
          updater(updatedSession);

          // 如果指定了 isManualEdit，设置 isTitleManuallyEdited 标志
          if (isManualEdit !== undefined) {
            updatedSession.isTitleManuallyEdited = isManualEdit;
          }

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
        const currentState = get();
        if (currentState.fetchState > 0) return;
        set(() => ({ fetchState: 1 }));
        fetch("/api/models", {
          method: "post",
          body: null,
          headers: {
            ...getHeaders(),
          },
        })
          .then((res) => res.json())
          .then((res: any) => {
            if (res.error) {
              console.error("[Config] 服务器配置错误:", res.message);
              // 设置错误状态，让组件显示错误页面
              set(() => ({
                models: [],
                configError: res.message,
                fetchState: 2,
              }));
            } else {
              console.log("[Config] got config from server", res);
              set(() => ({
                models: res.models,
                longTextModel: res.longTextModel,
                groupSessionModel: res.groupSessionModel,
                defaultModel: res.defaultModel,
                configError: null,
                fetchState: 2,
              }));
            }
          })
          .catch((error) => {
            console.error("[Config] failed to fetch config", error);
            set(() => ({
              models: [],
              configError: "无法连接到服务器，请检查网络连接",
              fetchState: 2,
            }));
          })
          .finally(() => {
            // fetchState 已经在各个分支中设置了
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

          // 过滤支持的文件类型（图片或任意文本文件），统一复用工具函数
          const supportedFiles = files.filter(
            (file) => isImageFileLike(file) || isTextFileLike(file),
          );

          if (supportedFiles.length === 0) {
            // console.warn("[ChatStore] 没有找到支持的文件类型");
            showToast("没有找到支持的文件类型（支持：图片 或 任意文本文件）");
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
              title: file.name, // 直接使用文件名作为标题，避免后续自动生成标题的冗余请求
              sourceName: file.name, // 记录源文件名
              model: determineModelForGroupSession(
                get().groupSessionModel,
                get().defaultModel as string,
              ), // 使用组会话模型或默认模型
              messageCount: 0,
              status: "normal",
              groupId: groupId,
              lastUpdate: Date.now(),
              messages: [],
              longInputMode: true,
              isModelManuallySelected: false,
            };

            // 处理文件内容并设置为系统提示词
            let systemText = "";
            let systemImages: string[] = [];

            try {
              if (isImageFileLike(file)) {
                // 图片文件：上传图片并添加到系统提示词
                const imageUrl = await uploadImage(file);
                systemImages.push(imageUrl);
              } else if (isTextFileLike(file)) {
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
      getExportFormat(): string {
        const state = get();
        return state.exportFormat || "image";
      },
      // 统一管理导出格式的保存
      setExportFormat(format: string): void {
        set({ exportFormat: format });
        debugLog("SET_EXPORT_FORMAT", "设置导出格式", {
          format,
          timestamp: Date.now(),
        });
      },

      // --- Session pagination methods ---
      // 设置分页状态
      setSessionPagination(
        pagination: Partial<typeof DEFAULT_CHAT_STATE.sessionPagination>,
      ): void {
        set((state) => ({
          sessionPagination: {
            ...state.sessionPagination,
            ...pagination,
          },
        }));
      },

      // 加载更多会话
      loadMoreSessions(): void {
        const state = get();
        const { sessions, sessionPagination } = state;
        const { pageSize, loadedCount, isLoading } = sessionPagination;

        // 如果正在加载或已加载全部，则返回
        if (isLoading || loadedCount >= sessions.length) {
          return;
        }

        // 计算新的加载数量
        const newLoadedCount = Math.min(
          loadedCount + pageSize,
          sessions.length,
        );
        const hasMore = newLoadedCount < sessions.length;

        // 更新状态
        set({
          sessionPagination: {
            ...sessionPagination,
            loadedCount: newLoadedCount,
            hasMore,
            isLoading: false, // 同步加载，不需要 loading 状态
          },
        });
      },

      // 重置分页状态（切换视图时调用）
      resetSessionPagination(): void {
        const state = get();
        const { sessions } = state;
        const initialCount = Math.min(
          SESSION_INITIAL_LOAD_COUNT,
          sessions.length,
        );

        set({
          sessionPagination: {
            pageSize: SESSION_PAGE_SIZE,
            loadedCount: initialCount,
            isLoading: false,
            hasMore: initialCount < sessions.length,
          },
        });
      },

      // 确保指定索引的会话已加载（用于选中会话时）
      ensureSessionLoaded(sessionIndex: number): void {
        const state = get();
        const { sessions, sessionPagination } = state;
        const { loadedCount } = sessionPagination;

        // 如果会话索引超出已加载范围，需要加载更多
        if (sessionIndex >= loadedCount) {
          // 加载到包含该会话的位置，并额外加载一些上下文
          const targetCount = Math.min(
            sessionIndex + SESSION_PAGE_SIZE,
            sessions.length,
          );

          set({
            sessionPagination: {
              ...sessionPagination,
              loadedCount: targetCount,
              hasMore: targetCount < sessions.length,
            },
          });
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

      // debugLog("PERSIST", "开始状态持久化", {
      //   sessionsCount: state.sessions.length,
      //   groupsCount: state.groups.length,
      //   groupSessionsCount: Object.keys(state.groupSessions).length,
      //   currentSessionIndex: state.currentSessionIndex,
      //   currentGroupIndex: state.currentGroupIndex,
      //   chatListView: state.chatListView,
      //   hasMobileViewState: "mobileViewState" in state,
      // });

      // 创建一个没有 messages 和标签页独立状态的 state副本
      const {
        // 标签页独立状态 (Ephemeral State) - 每个标签页应该独立维护
        currentSessionIndex,
        currentGroupIndex,
        chatListView,
        chatListGroupView,
        mobileViewState,
        sidebarScrollPosition,
        sidebarScrollHistory,
        batchApplyMode,
        activeBatchRequests,
        // 会话合并为临时 UI 状态，不持久化
        mergeMode,
        selectedSessionIdsForMerge,
        mergeOrderSessionIds,
        // 其他不需要持久化的运行时状态
        ...stateToPersist
      } = state;

      // 处理 sessions 和 groupSessions 中的 messages，确保它们不被持久化
      const processedStateToPersist = {
        ...stateToPersist,
        sessions: stateToPersist.sessions.map((session) => {
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
        groupSessions: Object.keys(stateToPersist.groupSessions).reduce(
          (acc, sessionId) => {
            const session = stateToPersist.groupSessions[sessionId];
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

      // 状态持久化完成

      debugLog("PERSIST", "状态持久化完成", {
        // 调试信息：确认独立状态被排除
        excludedIndexes: {
          currentSessionIndex,
          currentGroupIndex,
          chatListView,
          chatListGroupView,
        },
        persistedSessionsCount: processedStateToPersist.sessions.length,
        persistedGroupsCount: processedStateToPersist.groups.length,
        persistedGroupSessionsCount: Object.keys(
          processedStateToPersist.groupSessions,
        ).length,
        originalSessionsCount: state.sessions.length,
      });

      return processedStateToPersist as any; // 使用 any 类型避免复杂的类型推断问题
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
        // 开始状态恢复

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

          // 即使出错也设置数据恢复标志，避免无限循环
          isHydrated = true;
          setGlobalDataRestoredFlag(true);
          return;
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

          // ============================================================================
          // 多标签页支持：恢复标签页独立状态
          // ============================================================================
          if (hydratedState && typeof window !== "undefined") {
            // 生成标签页唯一标识
            const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            debugLog("REHYDRATE", "开始恢复标签页独立状态", {
              tabId,
              hydratedCurrentSessionIndex: hydratedState.currentSessionIndex,
              hydratedCurrentGroupIndex: hydratedState.currentGroupIndex,
              hydratedChatListView: hydratedState.chatListView,
            });

            // 异步加载最后保存的标签页状态
            loadTabState()
              .then((savedTabState) => {
                debugLog("REHYDRATE", "加载到保存的标签页状态", {
                  tabId,
                  savedState: savedTabState,
                  lastUpdated: savedTabState.lastUpdated,
                });

                // 验证保存的状态是否仍然有效
                const validSessionIndex = Math.max(
                  0,
                  Math.min(
                    savedTabState.currentSessionIndex,
                    hydratedState.sessions.length - 1,
                  ),
                );
                const validGroupIndex = Math.max(
                  0,
                  Math.min(
                    savedTabState.currentGroupIndex,
                    hydratedState.groups.length - 1,
                  ),
                );

                // 使用保存的状态，如果无效则使用默认值
                const finalTabState = {
                  currentSessionIndex: validSessionIndex,
                  currentGroupIndex: validGroupIndex,
                  chatListView: savedTabState.chatListView,
                  chatListGroupView: savedTabState.chatListGroupView,
                  mobileViewState: savedTabState.mobileViewState,
                  sidebarScrollPosition: savedTabState.sidebarScrollPosition,
                  sidebarScrollHistory: savedTabState.sidebarScrollHistory,
                  batchApplyMode: false, // 总是重置为 false
                  activeBatchRequests: 0, // 总是重置为 0
                };

                // 应用恢复的标签页状态
                useChatStore.setState((state) => ({
                  ...state,
                  ...finalTabState,
                }));

                debugLog("REHYDRATE", "标签页独立状态恢复完成", {
                  tabId,
                  finalCurrentSessionIndex: finalTabState.currentSessionIndex,
                  finalCurrentGroupIndex: finalTabState.currentGroupIndex,
                  finalChatListView: finalTabState.chatListView,
                  wasRestored: savedTabState.lastUpdated > 0,
                });
              })
              .catch((error) => {
                console.error(
                  "[REHYDRATE] 恢复标签页状态失败，使用默认状态:",
                  error,
                );

                // 如果恢复失败，使用默认状态
                useChatStore.setState((state) => ({
                  ...state,
                  ...DEFAULT_TAB_STATE,
                  batchApplyMode: false,
                  activeBatchRequests: 0,
                }));
              });
          }

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

              // 注册数据验证函数到应用准备管理器
              appReadyManager.registerDataValidator(validateChatStoreData);
              // 启动应用准备流程
              appReadyManager
                .ensureReady()
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
                    appReady: appReadyManager.isReady(),
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
                    debugLog("REHYDRATE", "数据损坏，继续运行", {
                      error: readyError.message,
                    });
                    // 即使数据损坏也继续运行，避免无限循环
                  } else {
                    // 其他错误，允许应用继续启动，但记录错误
                    // console.warn(
                    //   "[Store] 应用准备失败，但允许应用继续启动:",
                    //   readyError,
                    // );
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

// ============================================================================
// 标签页独立状态存储机制
// ============================================================================

// 标签页独立状态的存储键
const TAB_STATE_STORAGE_KEY = "tab-state";

// 标签页独立状态接口
interface TabIndependentState {
  currentSessionIndex: number;
  currentGroupIndex: number;
  chatListView: "sessions" | "groups";
  chatListGroupView: "groups" | "group-sessions";
  mobileViewState: "sidebar" | "chat" | "settings";
  sidebarScrollPosition: number;
  sidebarScrollHistory: Record<string, number>;
  batchApplyMode: boolean;
  activeBatchRequests: number;
  lastUpdated: number; // 最后更新时间戳
}

// 默认的标签页独立状态
const DEFAULT_TAB_STATE: TabIndependentState = {
  currentSessionIndex: 0,
  currentGroupIndex: 0,
  chatListView: "sessions",
  chatListGroupView: "groups",
  mobileViewState: "sidebar",
  sidebarScrollPosition: 0,
  sidebarScrollHistory: {},
  batchApplyMode: false,
  activeBatchRequests: 0,
  lastUpdated: Date.now(),
};

// 保存标签页独立状态到存储
async function saveTabState(
  state: Partial<TabIndependentState>,
): Promise<void> {
  if (typeof window === "undefined") return;

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const currentTabState = await loadTabState();
      const updatedTabState: TabIndependentState = {
        ...currentTabState,
        ...state,
        lastUpdated: Date.now(),
      };

      // 验证状态数据完整性
      if (!validateTabState(updatedTabState)) {
        throw new Error("标签页状态数据验证失败");
      }

      await jchatStorage.setItem(TAB_STATE_STORAGE_KEY, updatedTabState);

      debugLog("TAB_STATE", "标签页状态已保存", {
        savedState: state,
        lastUpdated: updatedTabState.lastUpdated,
        retryCount,
      });

      return; // 保存成功，退出重试循环
    } catch (error) {
      retryCount++;
      console.error(
        `[TAB_STATE] 保存标签页状态失败 (尝试 ${retryCount}/${maxRetries}):`,
        error,
      );

      if (retryCount >= maxRetries) {
        // 最后一次重试失败，记录错误但不抛出异常
        console.error("[TAB_STATE] 保存标签页状态最终失败，已放弃重试");
        return;
      }

      // 等待一段时间后重试
      await new Promise((resolve) => setTimeout(resolve, 200 * retryCount));
    }
  }
}

// 验证标签页状态数据完整性
function validateTabState(state: TabIndependentState): boolean {
  try {
    // 检查必需字段
    if (
      typeof state.currentSessionIndex !== "number" ||
      state.currentSessionIndex < 0
    ) {
      return false;
    }
    if (
      typeof state.currentGroupIndex !== "number" ||
      state.currentGroupIndex < 0
    ) {
      return false;
    }
    if (!["sessions", "groups"].includes(state.chatListView)) {
      return false;
    }
    if (!["groups", "group-sessions"].includes(state.chatListGroupView)) {
      return false;
    }
    if (!["sidebar", "chat", "settings"].includes(state.mobileViewState)) {
      return false;
    }
    if (
      typeof state.sidebarScrollPosition !== "number" ||
      state.sidebarScrollPosition < 0
    ) {
      return false;
    }
    if (
      typeof state.sidebarScrollHistory !== "object" ||
      state.sidebarScrollHistory === null
    ) {
      return false;
    }
    if (typeof state.batchApplyMode !== "boolean") {
      return false;
    }
    if (
      typeof state.activeBatchRequests !== "number" ||
      state.activeBatchRequests < 0
    ) {
      return false;
    }
    if (typeof state.lastUpdated !== "number" || state.lastUpdated <= 0) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("[TAB_STATE] 状态验证失败:", error);
    return false;
  }
}

// 从存储加载标签页独立状态
async function loadTabState(): Promise<TabIndependentState> {
  if (typeof window === "undefined") return DEFAULT_TAB_STATE;

  const maxRetries = 2;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const savedState = await jchatStorage.getItem(TAB_STATE_STORAGE_KEY);

      if (savedState && typeof savedState === "object") {
        const tabState: TabIndependentState = {
          ...DEFAULT_TAB_STATE,
          ...savedState,
        };

        // 验证加载的状态
        if (validateTabState(tabState)) {
          debugLog("TAB_STATE", "标签页状态已加载", {
            loadedState: tabState,
            lastUpdated: tabState.lastUpdated,
            retryCount,
          });
          return tabState;
        } else {
          console.warn("[TAB_STATE] 加载的状态验证失败，使用默认状态");
          return DEFAULT_TAB_STATE;
        }
      } else {
        // 没有保存的状态，返回默认状态
        debugLog("TAB_STATE", "没有找到保存的标签页状态，使用默认状态");
        return DEFAULT_TAB_STATE;
      }
    } catch (error) {
      retryCount++;
      console.error(
        `[TAB_STATE] 加载标签页状态失败 (尝试 ${retryCount}/${maxRetries}):`,
        error,
      );

      if (retryCount >= maxRetries) {
        console.error("[TAB_STATE] 加载标签页状态最终失败，使用默认状态");
        return DEFAULT_TAB_STATE;
      }

      // 等待一段时间后重试
      await new Promise((resolve) => setTimeout(resolve, 100 * retryCount));
    }
  }

  return DEFAULT_TAB_STATE;
}

// ============================================================================
// 跨标签页同步机制 - Broadcast Channel API
// ============================================================================

// 广播机制开关（写死关闭）
const ENABLE_BROADCAST_SYNC = false;

let broadcastChannel: BroadcastChannel | null = null;
const BROADCAST_CHANNEL_NAME = "jchat-state-sync";

// 将 broadcastChannel 暴露到全局，供其他组件使用
if (typeof window !== "undefined") {
  (window as any).__jchat_broadcast_channel = broadcastChannel;
}

// 使用已导出的 waitForDataRestoration 函数

// 启动跨标签页同步机制
function setupCrossTabSync() {
  // 检查广播机制开关
  if (!ENABLE_BROADCAST_SYNC) {
    debugLog("SYNC", "广播机制已关闭，跳过跨标签页同步");
    return;
  }

  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    debugLog("SYNC", "Broadcast Channel 不可用，跳过跨标签页同步");
    return;
  }

  // 仅在数据恢复完成后启动广播
  waitForDataRestoration().then(() => {
    try {
      if (broadcastChannel) {
        debugLog("SYNC", "Broadcast Channel 已存在，跳过重复初始化");
        return;
      }

      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

      // 更新全局引用
      if (typeof window !== "undefined") {
        (window as any).__jchat_broadcast_channel = broadcastChannel;
      }

      debugLog("SYNC", "Broadcast Channel 启动成功");

      // --- 监听来自其他标签页的同步请求 ---
      broadcastChannel.onmessage = (event) => {
        // 检查广播机制开关
        if (!ENABLE_BROADCAST_SYNC) {
          return;
        }

        // 收到广播消息

        debugLog("SYNC", "收到广播消息", {
          eventData: event.data,
          currentSessionsCount: useChatStore.getState().sessions.length,
        });

        const { type, payload } = event.data;

        if (type === "STATE_UPDATE_AVAILABLE") {
          // 收到状态更新通知，开始处理

          debugLog("SYNC", "收到来自其他标签页的更新通知，开始重新水合", {
            timestamp: payload?.lastUpdate,
            currentTime: Date.now(),
            changeType: payload?.changeType,
            beforeRehydrateSessionsCount:
              useChatStore.getState().sessions.length,
          });

          // 安全方法：直接从存储中读取最新数据，然后更新状态

          // 直接从存储中读取最新数据
          jchatStorage
            .getItem("chats")
            .then((storedData) => {
              // 从存储中读取到数据

              if (storedData && typeof storedData === "object") {
                // 解析存储的数据 - Zustand persist 可能包含版本信息
                const parsedData = storedData.state || storedData;
                // 解析存储数据 - 基础信息

                syncDebugLog("SYNC", "解析存储数据 - 标签页独立状态检查", {
                  hasCurrentSessionIndex: "currentSessionIndex" in parsedData,
                  currentSessionIndex: parsedData.currentSessionIndex,
                  hasCurrentGroupIndex: "currentGroupIndex" in parsedData,
                  currentGroupIndex: parsedData.currentGroupIndex,
                  hasChatListView: "chatListView" in parsedData,
                  chatListView: parsedData.chatListView,
                  hasMobileViewState: "mobileViewState" in parsedData,
                  mobileViewState: parsedData.mobileViewState,
                });

                // 记录更新前的状态
                const beforeUpdateState = useChatStore.getState();
                const beforeSessionId =
                  beforeUpdateState.sessions[
                    beforeUpdateState.currentSessionIndex
                  ]?.id;
                const beforeSessionTitle =
                  beforeUpdateState.sessions[
                    beforeUpdateState.currentSessionIndex
                  ]?.title;

                syncDebugLog("SYNC", "更新前状态", {
                  currentSessionIndex: beforeUpdateState.currentSessionIndex,
                  currentSessionId: beforeSessionId,
                  currentSessionTitle: beforeSessionTitle,
                });

                // 智能调整 currentSessionIndex：在新会话列表中找到原来的会话
                let adjustedCurrentSessionIndex =
                  beforeUpdateState.currentSessionIndex;
                if (beforeSessionId && parsedData.sessions) {
                  const newIndex = parsedData.sessions.findIndex(
                    (session: any) => session.id === beforeSessionId,
                  );
                  if (newIndex !== -1) {
                    adjustedCurrentSessionIndex = newIndex;
                    syncDebugLog("SYNC", "智能调整索引", {
                      originalIndex: beforeUpdateState.currentSessionIndex,
                      newIndex: adjustedCurrentSessionIndex,
                      sessionId: beforeSessionId,
                      sessionTitle: beforeSessionTitle,
                    });
                  } else {
                    syncDebugLog("SYNC", "未找到原会话，保持原索引", {
                      originalIndex: beforeUpdateState.currentSessionIndex,
                      sessionId: beforeSessionId,
                    });
                  }
                }

                // 设置标志：正在从同步更新状态
                isUpdatingFromSync = true;

                // 安全地更新状态，只更新全局共享状态
                useChatStore.setState((currentState) => {
                  syncDebugLog("SYNC", "当前状态", {
                    sessionsCount: currentState.sessions.length,
                    firstSessionTitle: currentState.sessions[0]?.title || "无",
                    // 检查当前标签页独立状态
                    currentSessionIndex: currentState.currentSessionIndex,
                    currentGroupIndex: currentState.currentGroupIndex,
                    chatListView: currentState.chatListView,
                    // 检查当前会话的详细信息
                    currentSessionId:
                      currentState.sessions[currentState.currentSessionIndex]
                        ?.id,
                    currentSessionTitle:
                      currentState.sessions[currentState.currentSessionIndex]
                        ?.title,
                  });

                  syncDebugLog("SYNC", "存储数据", {
                    sessionsCount: parsedData.sessions?.length || 0,
                    firstSessionTitle: parsedData.sessions?.[0]?.title || "无",
                  });

                  // 智能合并 sessions：保留本地已加载的 messages
                  const mergedSessions = parsedData.sessions
                    ? parsedData.sessions.map((newSession: any) => {
                        // 查找本地对应的会话
                        const localSession = currentState.sessions.find(
                          (s) => s.id === newSession.id,
                        );
                        // 如果本地会话有消息，保留它们；否则使用新会话的消息（通常是空数组）
                        return {
                          ...newSession,
                          messages:
                            localSession?.messages &&
                            localSession.messages.length > 0
                              ? localSession.messages
                              : newSession.messages,
                        };
                      })
                    : currentState.sessions;

                  syncDebugLog("SYNC", "合并后的 sessions", {
                    mergedSessionsCount: mergedSessions.length,
                    preservedMessagesCount: mergedSessions.filter(
                      (s: any) => s.messages && s.messages.length > 0,
                    ).length,
                  });

                  // 只更新全局共享状态，智能调整标签页独立状态
                  return {
                    ...currentState,
                    sessions: mergedSessions,
                    groups: parsedData.groups || currentState.groups,
                    // 智能合并 groupSessions：保留本地已加载的 messages
                    groupSessions: parsedData.groupSessions
                      ? Object.keys(parsedData.groupSessions).reduce(
                          (acc, sessionId) => {
                            const newSession =
                              parsedData.groupSessions[sessionId];
                            const localSession =
                              currentState.groupSessions[sessionId];
                            acc[sessionId] = {
                              ...newSession,
                              messages:
                                localSession?.messages &&
                                localSession.messages.length > 0
                                  ? localSession.messages
                                  : newSession.messages,
                            };
                            return acc;
                          },
                          {} as GroupSession,
                        )
                      : currentState.groupSessions,
                    accessCode:
                      parsedData.accessCode !== undefined
                        ? parsedData.accessCode
                        : currentState.accessCode,
                    models: parsedData.models || currentState.models,
                    exportFormat:
                      parsedData.exportFormat !== undefined
                        ? parsedData.exportFormat
                        : currentState.exportFormat,
                    expandMetrics:
                      parsedData.expandMetrics !== undefined
                        ? parsedData.expandMetrics
                        : currentState.expandMetrics,
                    // 智能调整 currentSessionIndex，确保继续查看原来的会话
                    currentSessionIndex: adjustedCurrentSessionIndex,
                  };
                });

                // 记录更新后的状态
                const afterUpdateState = useChatStore.getState();
                syncDebugLog("SYNC", "更新后状态", {
                  currentSessionIndex: afterUpdateState.currentSessionIndex,
                  currentSessionId:
                    afterUpdateState.sessions[
                      afterUpdateState.currentSessionIndex
                    ]?.id,
                  currentSessionTitle:
                    afterUpdateState.sessions[
                      afterUpdateState.currentSessionIndex
                    ]?.title,
                  indexChanged:
                    beforeUpdateState.currentSessionIndex !==
                    afterUpdateState.currentSessionIndex,
                });

                syncDebugLog("SYNC", "状态更新完成，UI应该重新渲染");

                // 确保当前会话的消息已加载
                setTimeout(async () => {
                  const currentSession = useChatStore
                    .getState()
                    .currentSession();

                  // 检查消息是否完整加载：消息数量应该与 messageCount 匹配
                  const messagesLength = currentSession?.messages?.length || 0;
                  const expectedMessageCount =
                    currentSession?.messageCount || 0;

                  // 检查消息内容是否一致（比较最后几条消息的ID和内容）
                  let messagesContentMismatch = false;
                  if (currentSession && messagesLength > 0) {
                    // 直接从 IndexedDB 加载最新的消息数据进行对比
                    try {
                      const latestMessages = await messageStorage.get(
                        currentSession.id,
                      );

                      if (latestMessages && latestMessages.length > 0) {
                        const currentMessages = currentSession.messages;

                        // 比较所有消息的ID和内容，确保完全同步
                        const maxLength = Math.max(
                          latestMessages.length,
                          currentMessages.length,
                        );

                        syncDebugLog("SYNC", "开始比较所有消息内容", {
                          sessionId: currentSession.id,
                          latestMessagesLength: latestMessages.length,
                          currentMessagesLength: currentMessages.length,
                          maxLength,
                        });

                        // 比较所有消息
                        for (let i = 0; i < maxLength; i++) {
                          const latestMsg = latestMessages[i];
                          const currentMsg = currentMessages[i];

                          // 如果任一边没有消息，说明数量不匹配
                          if (!latestMsg || !currentMsg) {
                            messagesContentMismatch = true;
                            syncDebugLog("SYNC", "检测到消息数量不匹配", {
                              index: i,
                              latestMsgExists: !!latestMsg,
                              currentMsgExists: !!currentMsg,
                            });
                            break;
                          }

                          // 比较消息ID和内容
                          if (
                            latestMsg.id !== currentMsg.id ||
                            latestMsg.content !== currentMsg.content
                          ) {
                            messagesContentMismatch = true;
                            syncDebugLog("SYNC", "检测到消息内容不匹配", {
                              index: i,
                              latestMsgId: latestMsg.id,
                              currentMsgId: currentMsg.id,
                              latestContent:
                                typeof latestMsg.content === "string"
                                  ? latestMsg.content.substring(0, 50)
                                  : "MultimodalContent",
                              currentContent:
                                typeof currentMsg.content === "string"
                                  ? currentMsg.content.substring(0, 50)
                                  : "MultimodalContent",
                            });
                            break;
                          }
                        }
                      } else {
                        syncDebugLog("SYNC", "存储中无消息数据，跳过内容比较");
                      }
                    } catch (error) {
                      console.error(
                        "SYNC",
                        "加载消息数据失败，跳过内容比较",
                        error,
                      );
                    }
                  }

                  const needsMessageLoading =
                    currentSession &&
                    (messagesLength === 0 ||
                      messagesLength !== expectedMessageCount ||
                      messagesContentMismatch);

                  if (needsMessageLoading) {
                    syncDebugLog(
                      "SYNC",
                      "检测到消息需要重新加载，开始加载消息",
                      {
                        sessionId: currentSession.id,
                        messageCount: currentSession.messageCount,
                        messagesLength: messagesLength,
                        messagesContentMismatch: messagesContentMismatch,
                        needsLoading: true,
                        reason:
                          messagesLength === 0
                            ? "消息未加载"
                            : messagesLength !== expectedMessageCount
                              ? "消息数量不匹配"
                              : "消息内容不匹配",
                      },
                    );

                    if (currentSession.groupId) {
                      // 组内会话：加载组内会话消息
                      useChatStore
                        .getState()
                        .loadGroupSessionMessages(currentSession.id);
                    } else {
                      // 普通会话：加载普通会话消息
                      useChatStore
                        .getState()
                        .loadSessionMessages(
                          useChatStore.getState().currentSessionIndex,
                        );
                    }

                    // 在消息加载完成后再重置标志，延长时间以确保所有后续状态更新完成
                    setTimeout(() => {
                      isUpdatingFromSync = false;
                      syncDebugLog("SYNC", "重置同步标志（消息加载后）");
                    }, 300); // 延长到 300ms
                  } else {
                    // 如果不需要加载消息，立即重置标志
                    syncDebugLog("SYNC", "消息已完整加载，无需重新加载", {
                      sessionId: currentSession?.id,
                      messageCount: currentSession?.messageCount || 0,
                      messagesLength: messagesLength,
                      messagesContentMismatch: messagesContentMismatch,
                      needsLoading: false,
                    });
                    setTimeout(() => {
                      isUpdatingFromSync = false;
                      syncDebugLog("SYNC", "重置同步标志（无需加载消息）");
                    }, 100);
                  }
                }, 100); // 延迟100ms确保状态更新完成
              } else {
                syncDebugLog("SYNC", "存储中没有找到数据，尝试重新水合");
                useChatStore.persist.rehydrate();
              }
            })
            .catch((error) => {
              console.error("SYNC", "从存储读取数据失败:", error);
              // 降级到重新水合
              useChatStore.persist.rehydrate();
            });
        }
      };

      // --- 监听本地状态变化并通知其他标签页 ---
      // 使用简单的状态监听，避免复杂的订阅配置
      let lastGlobalState: any = null;
      let isUpdatingFromSync = false; // 标志：是否正在从同步更新状态

      useChatStore.subscribe((state) => {
        // 检查广播机制开关
        if (!ENABLE_BROADCAST_SYNC) {
          return;
        }

        // 如果正在从同步更新状态，跳过广播
        if (isUpdatingFromSync) {
          syncDebugLog("SYNC", "跳过广播：正在从同步更新状态");
          return;
        }
        const currentGlobalState = {
          sessions: state.sessions,
          groups: state.groups,
          groupSessions: state.groupSessions,
          accessCode: state.accessCode,
          models: state.models,
          exportFormat: state.exportFormat,
          expandMetrics: state.expandMetrics,
        };

        // 如果是第一次调用，只记录状态，不广播
        if (lastGlobalState === null) {
          syncDebugLog("SYNC", "初始化状态监听", {
            sessionsCount: currentGlobalState.sessions.length,
            firstSessionTitle: currentGlobalState.sessions[0]?.title || "无",
          });
          lastGlobalState = currentGlobalState;
          return;
        }

        // 检查是否有结构性变化
        const sessionsLengthChanged =
          currentGlobalState.sessions.length !==
          lastGlobalState.sessions.length;
        const groupsLengthChanged =
          currentGlobalState.groups.length !== lastGlobalState.groups.length;
        const accessCodeChanged =
          currentGlobalState.accessCode !== lastGlobalState.accessCode;
        const modelsChanged =
          JSON.stringify(currentGlobalState.models) !==
          JSON.stringify(lastGlobalState.models);
        const exportFormatChanged =
          currentGlobalState.exportFormat !== lastGlobalState.exportFormat;
        const expandMetricsChanged =
          currentGlobalState.expandMetrics !== lastGlobalState.expandMetrics;

        // 检查会话内容变化（标题、消息数量等）
        const sessionsContentChanged = currentGlobalState.sessions.some(
          (session: any, index: number) => {
            const lastSession = lastGlobalState.sessions[index];
            if (!lastSession || lastSession.id !== session.id) return true;
            // 比较会话的关键属性（不包括 messages 内容，只比较 messageCount）
            return (
              lastSession.title !== session.title ||
              lastSession.messageCount !== session.messageCount ||
              lastSession.model !== session.model ||
              lastSession.groupId !== session.groupId
            );
          },
        );

        const hasStructuralChange =
          sessionsLengthChanged ||
          groupsLengthChanged ||
          accessCodeChanged ||
          modelsChanged ||
          exportFormatChanged ||
          expandMetricsChanged ||
          sessionsContentChanged;

        debugLog("SYNC_CHECK", "检查结构性变化", {
          sessionsLengthChanged,
          hasStructuralChange,
          currentSessionsCount: currentGlobalState.sessions.length,
          lastSessionsCount: lastGlobalState.sessions.length,
        });

        // 检查组内会话变化
        const currentGroupSessionKeys = Object.keys(
          currentGlobalState.groupSessions,
        );
        const prevGroupSessionKeys = Object.keys(lastGlobalState.groupSessions);
        const hasGroupSessionChange =
          currentGroupSessionKeys.length !== prevGroupSessionKeys.length ||
          currentGroupSessionKeys.some(
            (key) =>
              !prevGroupSessionKeys.includes(key) ||
              JSON.stringify(currentGlobalState.groupSessions[key]) !==
                JSON.stringify(lastGlobalState.groupSessions[key]),
          );

        // 只有当结构性变化时才广播，groupSessions 变化不广播
        if (hasStructuralChange) {
          syncDebugLog("SYNC", "检测到结构性变化，准备广播", {
            hasStructuralChange,
            hasGroupSessionChange,
            sessionsCount: currentGlobalState.sessions.length,
            sessionsLengthChanged,
            currentSessionsLength: currentGlobalState.sessions.length,
            lastSessionsLength: lastGlobalState.sessions.length,
          });

          debugLog("SYNC", "全局状态发生结构性变化，广播通知其他标签页", {
            structuralChange: hasStructuralChange,
            groupSessionChange: hasGroupSessionChange,
            sessionsCount: currentGlobalState.sessions.length,
            groupsCount: currentGlobalState.groups.length,
            groupSessionsCount: currentGroupSessionKeys.length,
          });

          // 延迟广播，确保存储写入完成
          setTimeout(() => {
            // 再次检查广播机制开关
            if (!ENABLE_BROADCAST_SYNC) {
              return;
            }

            const message = {
              type: "STATE_UPDATE_AVAILABLE",
              payload: {
                lastUpdate: Date.now(),
                changeType: "structural",
              },
            };

            debugLog("SYNC", "发送广播消息", {
              message,
              broadcastChannelExists: !!broadcastChannel,
            });

            broadcastChannel?.postMessage(message);
          }, 100); // 延迟 100ms 确保存储写入完成
        } else if (hasGroupSessionChange) {
          // groupSessions 变化时不广播，只记录日志
          syncDebugLog("SYNC", "检测到组会话变化，但不进行广播", {
            hasGroupSessionChange,
            groupSessionsCount: currentGroupSessionKeys.length,
          });
        }

        // 更新上次状态
        lastGlobalState = currentGlobalState;
      });

      debugLog("SYNC", "跨标签页同步机制设置完成");
    } catch (error) {
      console.error("SYNC", "Broadcast Channel setup failed:", error);
    }
  });
}

// ============================================================================
// 标签页独立状态自动保存机制
// ============================================================================

// 防抖保存机制
let saveTimeout: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_DELAY = 500; // 500ms 防抖延迟

// 批量保存队列
let pendingSaveState: Partial<TabIndependentState> | null = null;

// 执行防抖保存
function debouncedSave(state: Partial<TabIndependentState>) {
  // 合并到待保存状态
  pendingSaveState = { ...pendingSaveState, ...state };

  // 清除之前的定时器
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  // 设置新的定时器
  saveTimeout = setTimeout(async () => {
    if (pendingSaveState) {
      try {
        await saveTabState(pendingSaveState);
        debugLog("TAB_STATE_DEBOUNCED_SAVE", "防抖保存完成", {
          savedState: pendingSaveState,
        });
      } catch (error) {
        console.error("TAB_STATE_DEBOUNCED_SAVE", "防抖保存失败:", error);
      } finally {
        pendingSaveState = null;
      }
    }
  }, SAVE_DEBOUNCE_DELAY);
}

// 立即保存（用于重要状态变化）
function immediateSave(state: Partial<TabIndependentState>) {
  // 清除防抖定时器
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  // 立即保存
  saveTabState(state)
    .then(() => {
      debugLog("TAB_STATE_IMMEDIATE_SAVE", "立即保存完成", {
        savedState: state,
      });
    })
    .catch((error) => {
      console.error("TAB_STATE_IMMEDIATE_SAVE", "立即保存失败:", error);
    });
}

// 设置标签页独立状态的自动保存
function setupTabStateAutoSave() {
  if (typeof window === "undefined") return;

  // 等待数据恢复完成后再设置自动保存
  waitForDataRestoration().then(() => {
    debugLog("TAB_STATE_AUTO_SAVE", "开始设置标签页状态自动保存");

    // 监听标签页独立状态的变化
    let lastTabState: Partial<TabIndependentState> = {};

    useChatStore.subscribe((state) => {
      const currentTabState = {
        currentSessionIndex: state.currentSessionIndex,
        currentGroupIndex: state.currentGroupIndex,
        chatListView: state.chatListView,
        chatListGroupView: state.chatListGroupView,
        mobileViewState: state.mobileViewState,
        sidebarScrollPosition: state.sidebarScrollPosition,
        sidebarScrollHistory: state.sidebarScrollHistory,
        batchApplyMode: state.batchApplyMode,
        activeBatchRequests: state.activeBatchRequests,
      };

      // 检查是否有变化
      const hasChanged = Object.keys(currentTabState).some(
        (key) =>
          currentTabState[key as keyof typeof currentTabState] !==
          lastTabState[key as keyof typeof lastTabState],
      );

      if (hasChanged) {
        const changedFields = Object.keys(currentTabState).filter(
          (key) =>
            currentTabState[key as keyof typeof currentTabState] !==
            lastTabState[key as keyof typeof lastTabState],
        );

        debugLog("TAB_STATE_AUTO_SAVE", "检测到标签页状态变化", {
          changedFields,
          newState: currentTabState,
        });

        // 根据变化类型选择保存策略
        const isImportantChange = changedFields.some((field) =>
          ["currentSessionIndex", "currentGroupIndex", "chatListView"].includes(
            field,
          ),
        );

        if (isImportantChange) {
          // 重要状态变化立即保存
          immediateSave(currentTabState);
        } else {
          // 其他状态变化使用防抖保存
          debouncedSave(currentTabState);
        }

        // 更新上次状态
        lastTabState = { ...currentTabState };
      }
    });

    debugLog("TAB_STATE_AUTO_SAVE", "标签页状态自动保存设置完成");
  });
}

// 在文件末尾或应用启动时调用
// 确保在 useChatStore 定义之后执行
setTimeout(() => {
  debugLog("STARTUP", "开始初始化多标签页功能");
  setupCrossTabSync();
  setupTabStateAutoSave();
  debugLog("STARTUP", "多标签页功能初始化完成");
}, 0);
