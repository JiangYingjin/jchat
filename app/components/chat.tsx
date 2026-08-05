"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isEmpty } from "lodash-es";
import { nanoid } from "nanoid";

// --- Local Imports ---
import {
  ChatMessage,
  useChatStore,
  SystemMessageData,
  systemMessageStorage,
  ChatSession,
} from "../store";
import { useShallow } from "zustand/react/shallow";
import { useAppReadyGuard } from "../hooks/app-ready";
import { useSubmitHandler, useTripleClick } from "../utils/hooks";
import { useScrollState } from "../hooks/use-scroll-state";
import { updateSessionStatsBasic, updateSessionStats } from "../utils/session";
import {
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
} from "../utils";
import { determineModelForSystemPrompt } from "../utils/model";
import { prettyObject } from "../utils/format";
import { handleUnauthorizedResponse, handleUrlAuthCode } from "../utils/auth";
import { findMessagePairForResend } from "../utils/message";
import { parseGroupMessageId, checkBatchAlreadyApplied } from "../utils/group";
import { createSmartPositionCallback } from "../utils/editor";
import { createModuleLogger } from "../utils/logger";

// --- Client & Constants ---
import { ChatControllerPool } from "../client/controller";
import { REQUEST_TIMEOUT_MS } from "../constant";
import Locale from "../locales";

// --- Components ---
import { showToast } from "./ui-lib";
import { ChatInputPanel } from "./chat-input-panel";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import {
  SystemPromptEditDialog,
  MessageEditDialog,
} from "./message-edit-dialog";
import { SessionEditor } from "./session-editor";
import { ExportMessageModal } from "./exporter";

// --- Styles ---
import styles from "../styles/chat.module.scss";

const chatLogger = createModuleLogger("CHAT");

// 提取调试日志工具函数
const debugLog = (category: string, message: string, data?: any) => {
  chatLogger.debug(category, message, data);
};

// 提取重复的常量
const TOAST_TIMEOUT = 5000;
const REVERT_TIMEOUT = 5100;
const MESSAGE_PREVIEW_LENGTH = 50;
const MESSAGE_SHORT_PREVIEW_LENGTH = 30;
const COMPARE_MESSAGE_COUNT = 2;

// 提取重复的工具函数
const createMessagePreview = (
  content: any,
  maxLength: number = MESSAGE_PREVIEW_LENGTH,
) => {
  return typeof content === "string"
    ? content.substring(0, maxLength)
    : "MultimodalContent";
};

const createSessionUpdateHandler = (chatStore: any, session: any) => {
  return (updater: (session: any) => void) => {
    if (session.groupId) {
      chatStore.updateGroupSession(session, updater);
    } else {
      chatStore.updateSession(session, updater);
    }
  };
};

const createSessionSaveHandler = async (chatStore: any, session: any) => {
  const currentSession = chatStore.currentSession();
  await chatStore.saveSessionMessages(currentSession);
  await updateSessionStats(currentSession);

  if (currentSession.groupId) {
    chatStore.updateGroupSession(currentSession, (session: any) => {});
  } else {
    chatStore.updateSession(currentSession, (session: any) => {});
  }
};

// 提取通用的调试日志函数
const createSessionDebugLog = (
  session: any,
  category: string,
  message: string,
) => {
  return {
    sessionId: session.id,
    sessionTitle: session.title,
    messageCount: session.messageCount,
    messagesLength: session.messages?.length || 0,
    hasMessages: !!(session.messages && session.messages.length > 0),
    messagesPreview:
      session.messages?.slice(0, COMPARE_MESSAGE_COUNT).map((m: any) => ({
        role: m.role,
        content: createMessagePreview(m.content),
      })) || [],
    timestamp: Date.now(),
  };
};

// 提取通用的会话加载逻辑
const loadSessionMessages = (chatStore: any, session: any) => {
  if (session && (!session.messages || session.messages.length === 0)) {
    if (session.groupId) {
      // 组内会话：加载组内会话消息
      chatStore.loadGroupSessionMessages(session.id);
    } else {
      // 普通会话：加载普通会话消息
      chatStore.loadSessionMessages(chatStore.currentSessionIndex);
    }
  }
};

// 提取通用的模态框状态管理 Hook
const useModalStateManager = () => {
  const [showExport, setShowExport] = useState(false);
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [showSystemPromptEdit, setShowSystemPromptEdit] = useState(false);
  const [showEditMessageModal, setShowEditMessageModal] = useState(false);

  return {
    showExport,
    setShowExport,
    isEditingSession,
    setIsEditingSession,
    showSystemPromptEdit,
    setShowSystemPromptEdit,
    showEditMessageModal,
    setShowEditMessageModal,
  };
};

// 将选择器和比较函数提取到组件外部，避免每次渲染时重新创建
const selectCurrentSession = (state: any) => {
  const {
    chatListView,
    chatListGroupView,
    groups,
    currentGroupIndex,
    groupSessions,
    sessions,
    currentSessionIndex,
  } = state;

  // 普通会话模式：从 sessions 数组获取
  if (chatListView === "sessions") {
    if (
      sessions.length === 0 ||
      currentSessionIndex < 0 ||
      currentSessionIndex >= sessions.length
    ) {
      return null;
    }
    return sessions[currentSessionIndex];
  }

  // 组会话模式：根据组内视图决定返回哪个会话
  if (chatListView === "groups") {
    // 组内会话模式：返回当前组的当前会话
    if (chatListGroupView === "group-sessions") {
      const currentGroup = groups[currentGroupIndex];
      if (currentGroup && currentGroup.sessionIds.length > 0) {
        const currentSessionId =
          currentGroup.sessionIds[currentGroup.currentSessionIndex];
        const session = groupSessions[currentSessionId];
        if (session) {
          return session;
        }
      }
    }

    // 组列表模式：返回当前组的第一个会话
    if (chatListGroupView === "groups") {
      const currentGroup = groups[currentGroupIndex];
      if (currentGroup && currentGroup.sessionIds.length > 0) {
        const firstSessionId = currentGroup.sessionIds[0];
        const session = groupSessions[firstSessionId];
        if (session) {
          return session;
        }
      }
    }
  }

  return null;
};

const Chat = React.memo(function Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  // --- State, Refs, and Hooks ---
  // 使用细粒度订阅，只订阅当前会话对象
  // 使用useShallow替代弃用的equalityFn参数
  const currentSession = useChatStore(
    useShallow((state) => selectCurrentSession(state)),
  );

  const sessionId = currentSession?.id;

  // 保留 chatStore 用于调用方法，但不用于状态订阅
  // 使用 useChatStore.getState() 来访问方法而不订阅状态变化
  const chatStore = React.useMemo(() => useChatStore.getState(), []);

  // 由于使用了自定义选择器和比较函数，currentSession 已经是稳定的了
  // ChatPage 已经确保了 currentSession 不会为 null
  const session = currentSession as ChatSession;

  // 追踪会话对象变化的原因
  const prevSessionRef = React.useRef<{
    id: string | null;
    title: string | null;
    messagesLength: number;
    messages: any[];
  }>({ id: null, title: null, messagesLength: 0, messages: [] });

  const renderReason = React.useMemo(() => {
    if (!prevSessionRef.current.id) return "初始渲染";
    if (prevSessionRef.current.id !== session.id) return "会话切换";
    if (prevSessionRef.current.title !== session.title)
      return `标题变化 (${prevSessionRef.current.title} -> ${session.title})`;
    if (
      prevSessionRef.current.messagesLength !== (session.messages?.length || 0)
    ) {
      return `消息数量变化 (${prevSessionRef.current.messagesLength} -> ${session.messages?.length || 0})`;
    }

    // 检查消息内容是否变化（比较最后几条消息）
    const prevMessages = prevSessionRef.current.messages || [];
    const currentMessages = session.messages || [];
    const compareCount = Math.min(
      2,
      Math.min(prevMessages.length, currentMessages.length),
    );

    for (let i = 0; i < compareCount; i++) {
      const prevMsg = prevMessages[prevMessages.length - 1 - i];
      const currentMsg = currentMessages[currentMessages.length - 1 - i];

      if (
        prevMsg &&
        currentMsg &&
        (prevMsg.id !== currentMsg.id || prevMsg.content !== currentMsg.content)
      ) {
        return `消息内容变化 (最后${i + 1}条消息)`;
      }
    }

    return "无变化（不应该渲染）";
  }, [session.id, session.title, session.messages]);

  React.useEffect(() => {
    prevSessionRef.current = {
      id: session.id,
      title: session.title,
      messagesLength: session.messages?.length || 0,
      messages: session.messages || [],
    };
  });

  debugLog("CHAT", "🔥 Chat组件渲染", {
    sessionId,
    sessionTitle: session.title,
    messageCount: session.messageCount,
    messagesLength: session.messages?.length || 0,
    renderReason,
    timestamp: Date.now(),
  });

  const allModels = chatStore.models;

  // 添加调试信息，追踪会话变化和组件重新渲染
  useEffect(() => {
    debugLog(
      "CHAT",
      "🔥 会话变化",
      createSessionDebugLog(session, "CHAT", "🔥 会话变化"),
    );
  }, [session]);

  // 添加组件挂载/卸载调试信息
  useEffect(() => {
    debugLog("CHAT", "🔥 组件挂载", {
      sessionId: session.id,
      sessionTitle: session.title,
      timestamp: Date.now(),
    });

    return () => {
      debugLog("CHAT", "🔥 组件卸载", {
        sessionId: session.id,
        sessionTitle: session.title,
        timestamp: Date.now(),
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobileScreen = useMobileScreen();

  const messageEditRef = useRef<HTMLElement>(null);

  // Component State
  const [isLoading, setIsLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hitBottom, setHitBottom] = useState(true); // Managed by MessageList, passed down

  // Modal Visibility State - 使用通用的模态框状态管理
  const {
    showExport,
    setShowExport,
    isEditingSession,
    setIsEditingSession,
    showSystemPromptEdit,
    setShowSystemPromptEdit,
    showEditMessageModal,
    setShowEditMessageModal,
  } = useModalStateManager();

  // Data for Modals
  const [systemPromptData, setSystemPromptData] = useState<SystemMessageData>({
    text: "",
    images: [],
    scrollTop: 0,
    selection: { start: 0, end: 0 },
    updateAt: Date.now(),
  });
  const [editMessageData, setEditMessageData] = useState<{
    message: ChatMessage;
    type: "content" | "reasoningContent";
    select: { anchorText: string; extendText: string };
  } | null>(null);

  // Custom Hooks
  useSubmitHandler();
  const handleTripleClick = useTripleClick(messageEditRef);

  // --- Memoized and Derived Values ---
  const messages = useMemo(() => {
    // Filter out system messages for rendering
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  const autoFocus = !isMobileScreen; // Wont auto focus on mobile screens

  // --- Core Logic Handlers ---

  // 根据会话类型选择正确的更新方法
  const updateSession = useCallback(
    (updater: (session: ChatSession) => void) => {
      if (session.groupId) {
        chatStore.updateGroupSession(session, updater);
      } else {
        chatStore.updateSession(session, updater);
      }
    },
    [session, chatStore],
  );

  const handleSubmit = (text: string, images: string[]) => {
    if (text.trim() === "" && isEmpty(images)) return;

    setIsLoading(true);
    chatStore
      .onSendMessage(text, images)
      .then(async () => {
        setIsLoading(false);
        // onSendMessage 内部已经正确处理了消息保存，无需重复保存
      })
      .catch((error) => {
        console.error("[Chat] ❌ 消息发送失败", {
          sessionId: session.id,
          error: error.message,
          step: "handleSubmit-error",
        });
        setIsLoading(false);
      });
    setAutoScroll(hitBottom);
  };

  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  const onResend = (message: ChatMessage) => {
    debugLog("RESEND", "🔥 开始重新发送消息", {
      targetMessageId: message.id,
      targetMessageRole: message.role,
      targetMessageContent: createMessagePreview(message.content),
      sessionId: session.id,
      sessionMessagesLength: session.messages?.length || 0,
      sessionHasMessages: !!(session.messages && session.messages.length > 0),
      sessionMessagesPreview:
        session.messages?.map((m) => ({
          id: m.id,
          role: m.role,
          content: createMessagePreview(
            m.content,
            MESSAGE_SHORT_PREVIEW_LENGTH,
          ),
        })) || [],
    });

    // 🔧 添加调试信息：记录resend前的消息状态
    debugLog("RESEND", "🔍 重新发送前消息状态", {
      sessionId: session.id,
      messagesCount: session.messages?.length || 0,
      messagesIds: session.messages?.map((m) => m.id) || [],
      targetMessageIndex:
        session.messages?.findIndex((m) => m.id === message.id) ?? -1,
    });

    // 检查 session.messages 是否已加载
    if (!session.messages || session.messages.length === 0) {
      console.error("[Chat] ❌ 重新发送失败：session.messages 为空或未加载", {
        sessionId: session.id,
        messageCount: session.messageCount,
        messagesLength: session.messages?.length || 0,
      });
      return;
    }

    const { userMessage, botMessage, requestIndex } = findMessagePairForResend(
      session.messages,
      message.id,
    );

    debugLog("RESEND", "🔥 findMessagePairForResend 结果", {
      userMessage: userMessage
        ? { id: userMessage.id, role: userMessage.role }
        : null,
      botMessage: botMessage
        ? { id: botMessage.id, role: botMessage.role }
        : null,
      requestIndex,
      findResult: !userMessage ? "未找到用户消息" : "找到用户消息",
    });

    if (!userMessage) {
      console.error("[Chat] ❌ 重新发送失败：未找到用户消息", {
        targetMessage: message,
        targetMessageId: message.id,
        sessionMessagesIds: session.messages.map((m) => m.id),
        isMessageIdInSession: session.messages.some((m) => m.id === message.id),
      });
      return;
    }

    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);

    // 🔧 修复重试逻辑：使用 batchId 机制或 messageIdx
    let userBatchId: string | undefined;
    let modelBatchId: string | undefined;
    let messageIdx: number | undefined = undefined;

    if (session.groupId) {
      // 解析用户消息的 batch id
      const parsedId = parseGroupMessageId(userMessage.id);
      if (parsedId.isValid) {
        // 重试时保持用户消息的 batchId 不变，但生成新的模型消息 batchId
        userBatchId = parsedId.batchId;
        modelBatchId = nanoid(12);

        // 🚨 关键修复：组内会话重试时也需要传递 messageIdx 来截取消息列表
        messageIdx = requestIndex;
      }
    } else {
      // 普通会话，传递 requestIndex 作为 messageIdx
      messageIdx = requestIndex;
    }

    chatStore
      .onSendMessage(
        textContent,
        images,
        messageIdx, // 🚨 关键修复：组内会话和普通会话都传递 messageIdx
        undefined, // 当前会话
        userBatchId, // 组内会话 batchId
        modelBatchId, // 组内会话模型 batchId
      )
      .then(async () => {
        setIsLoading(false);
        // 🔧 添加调试信息：记录resend完成后的状态
        debugLog("RESEND", "🔍 重新发送完成", {
          sessionId: session.id,
          messagesCount: session.messages?.length || 0,
          messagesIds: session.messages?.map((m) => m.id) || [],
        });
      })
      .catch((error) => {
        console.error("[onResend] 重试失败:", error);
        setIsLoading(false);
      });
    // 仅在用户视图已在底部时保持自动滚动
    setAutoScroll(hitBottom);
  };

  const deleteMessage = async (msgId?: string) => {
    updateSession((session) => {
      session.messages = session.messages.filter((m) => m.id !== msgId);
      updateSessionStatsBasic(session); // 先同步更新基础统计信息
    });

    await createSessionSaveHandler(chatStore, session);
  };

  const onDelete = (msgId: string) => {
    const prevMessages = session.messages.slice();
    let isDeleted = true; // 标记是否真正删除

    deleteMessage(msgId);
    showToast(
      Locale.Chat.DeleteMessageToast,
      {
        text: Locale.Chat.Revert,
        async onClick() {
          isDeleted = false; // 用户撤销了删除
          updateSession((session) => {
            session.messages = prevMessages;
            updateSessionStatsBasic(session); // 先同步更新基础统计信息
          });

          await createSessionSaveHandler(chatStore, session);
        },
      },
      TOAST_TIMEOUT,
    );

    // 撤销超时后（5秒），如果用户没有撤销，则广播删除事件
    setTimeout(() => {
      if (isDeleted) {
        debugLog("MESSAGE_SYNC", "🔥 消息删除确认，广播更新", {
          sessionId: session.id,
          messageId: msgId,
          messageCount: session.messageCount,
          timestamp: Date.now(),
        });

        // 直接发送广播消息，不依赖状态变化检测
        if (
          typeof window !== "undefined" &&
          (window as any).__jchat_broadcast_channel
        ) {
          const message = {
            type: "STATE_UPDATE_AVAILABLE",
            payload: {
              lastUpdate: Date.now(),
              changeType: "messageUpdate", // 专门的消息更新类型
              sessionId: session.id,
            },
          };

          debugLog("MESSAGE_SYNC", "🔥 发送消息删除广播", {
            message,
            broadcastChannelExists: !!(window as any).__jchat_broadcast_channel,
          });

          (window as any).__jchat_broadcast_channel.postMessage(message);
        } else {
          console.warn(
            "MESSAGE_SYNC",
            "🔥 Broadcast Channel 不存在，无法发送广播",
          );
        }
      }
    }, REVERT_TIMEOUT); // 略大于 Toast 超时时间，确保用户已经无法撤销
  };

  const handleBranch = async (message: ChatMessage, messageIndex: number) => {
    try {
      await chatStore.branchSessionFrom(message, messageIndex);
    } catch (error) {
      console.error("Failed to branch session:", error);
      showToast(Locale.Chat.Actions.BranchFailed);
    }
  };

  const handleBatchApply = async (message: ChatMessage) => {
    // 只有组内会话才支持批量应用
    if (!session.groupId) {
      showToast("只有组内会话支持批量应用功能");
      return;
    }

    // 🔧 性能优化：启用批量应用模式，减少渲染频率
    chatStore.setBatchApplyMode(true);

    let anchorUserMessage: ChatMessage | undefined = undefined;
    let anchorMessage: ChatMessage = message;
    let isAssistant = false;

    if (message.role === "assistant") {
      // 查找上一个用户消息
      const idx = session.messages.findIndex((m: any) => m.id === message.id);
      if (idx === -1) {
        showToast("无法找到当前模型消息");
        return;
      }
      // 向上查找第一个用户消息
      for (let i = idx - 1; i >= 0; --i) {
        if (session.messages[i].role === "user") {
          anchorUserMessage = session.messages[i];
          break;
        }
      }
      if (!anchorUserMessage) {
        showToast("缺失对应用户消息，无法批量应用");
        return;
      }
      anchorMessage = anchorUserMessage;
      isAssistant = true;
    } else if (message.role === "user") {
      anchorUserMessage = message;
    } else {
      showToast("只有用户消息或模型消息支持批量应用");
      return;
    }

    try {
      // 解析消息的 batch id
      const parsedId = parseGroupMessageId(anchorMessage.id);

      if (!parsedId.isValid) {
        showToast("消息格式不支持批量应用");
        return;
      }

      const userBatchId = parsedId.batchId;
      const currentGroupId = session.groupId;

      // 获取当前组的所有会话
      const currentGroup = chatStore.groups.find(
        (g) => g.id === currentGroupId,
      );
      if (!currentGroup) {
        showToast("无法找到当前组信息");
        return;
      }

      // 找到 anchor 用户消息在消息列表中的位置
      const userMessageIndex = session.messages.findIndex(
        (m: any) => m.id === anchorMessage.id,
      );
      if (userMessageIndex === -1) {
        showToast("无法找到用户消息");
        return;
      }

      // 检查用户消息的下一个消息是否是模型回复消息
      const nextMessage = session.messages[userMessageIndex + 1];
      const hasModelReply = nextMessage && nextMessage.role === "assistant";

      if (!hasModelReply) {
        showToast("请先重试该消息，核对模型回复内容无误后，再进行批量应用");
        return;
      }

      // 获取模型回复消息的 batch id，用于在其他会话中创建相同的 batch id
      const modelMessageParsedId = parseGroupMessageId(nextMessage.id);
      const modelBatchId = modelMessageParsedId.isValid
        ? modelMessageParsedId.batchId
        : userBatchId;

      // 遍历组内所有会话（包括当前会话）
      let appliedCount = 0;
      let skippedCount = 0;

      for (const sessionId of currentGroup.sessionIds) {
        // 先确保目标会话的消息已加载（必须等待加载完成！）
        await chatStore.loadGroupSessionMessages(sessionId);
        const targetSession = chatStore.groupSessions[sessionId]; // 重新获取，确保是最新的
        if (!targetSession || !targetSession.messages) {
          console.warn(`[BatchApply] 加载消息失败，sessionId=${sessionId}`);
          continue;
        }

        // 🔧 预检查机制 - 检查是否已成功应用相同批次的消息（包括当前会话）
        const checkResult = checkBatchAlreadyApplied(
          targetSession,
          userBatchId,
          anchorUserMessage!,
        );

        if (checkResult.alreadyApplied) {
          const sessionType = sessionId === session.id ? "当前会话" : "会话";
          debugLog(
            "BatchApply",
            `跳过${sessionType} ${sessionId}: ${checkResult.reason}`,
          );
          skippedCount++;
          continue;
        } else {
          const sessionType = sessionId === session.id ? "当前会话" : "会话";
          debugLog(
            "BatchApply",
            `需要应用到${sessionType} ${sessionId}: ${checkResult.reason}`,
          );
        }

        // 🔧 优化：直接使用 onSendMessage 的 batchId 机制
        // 这样会自动处理：
        // 1. 如果找到现有的 batchId 消息，更新用户消息内容，删除模型消息，插入新的模型消息
        // 2. 如果没找到，追加到末尾
        const textContent = getMessageTextContent(anchorMessage);
        const images = getMessageImages(anchorMessage);

        await chatStore.onSendMessage(
          textContent,
          images,
          undefined, // 不传 messageIdx，让 batchId 机制处理
          sessionId,
          userBatchId, // 用户消息使用原始的用户 batch id
          modelBatchId, // 模型消息使用模型回复消息的 batch id
        );

        appliedCount++;
      }

      // 显示详细的应用结果
      if (appliedCount === 0 && skippedCount > 0) {
        showToast(
          `所有会话都已成功应用过此消息，跳过了 ${skippedCount} 个会话`,
        );
      } else if (appliedCount > 0 && skippedCount === 0) {
        showToast(`批量应用已提交到 ${appliedCount} 个会话，正在处理中...`);
      } else if (appliedCount > 0 && skippedCount > 0) {
        showToast(
          `批量应用已提交到 ${appliedCount} 个会话，跳过了 ${skippedCount} 个已应用的会话`,
        );
      } else {
        showToast("没有需要应用的会话");
      }
    } catch (error) {
      console.error("[BatchApply] Failed to apply batch:", error);
      showToast("批量应用失败，请重试");
      // 🔧 出错时手动退出批量模式
      chatStore.setBatchApplyMode(false);
    }
    // 注意：不再手动退出批量模式，系统会在所有流式响应完成后自动退出
  };

  const handleBatchDelete = async (message: ChatMessage) => {
    try {
      // 解析消息的 batch id
      const parsedId = parseGroupMessageId(message.id);

      if (!parsedId.isValid) {
        showToast("消息格式不支持批量删除");
        return;
      }

      const batchId = parsedId.batchId;
      const currentGroupId = session.groupId;

      // 获取当前组的所有会话
      const currentGroup = chatStore.groups.find(
        (g) => g.id === currentGroupId,
      );
      if (!currentGroup) {
        showToast("无法找到当前组信息");
        return;
      }

      // 保存删除前的所有会话状态用于撤销
      const restoreStates: { [sessionId: string]: ChatMessage[] } = {};

      // 遍历组内所有会话，删除相同 batch id 且 role 相同的消息
      for (const sessionId of currentGroup.sessionIds) {
        const targetSession = chatStore.groupSessions[sessionId];
        if (!targetSession) {
          continue;
        }

        // 确保目标会话的消息已加载
        if (!targetSession.messages || targetSession.messages.length === 0) {
          await chatStore.loadGroupSessionMessages(sessionId);
        }

        // 保存删除前的消息状态
        restoreStates[sessionId] = [...targetSession.messages];

        // 查找并删除相同 batch id 且 role 相同的消息
        const messagesToDelete = targetSession.messages.filter((m) => {
          const parsed = parseGroupMessageId(m.id);
          return (
            parsed.isValid &&
            parsed.batchId === batchId &&
            m.role === message.role
          );
        });

        if (messagesToDelete.length > 0) {
          // 删除相同 batch id 且 role 相同的消息
          chatStore.updateGroupSession(targetSession, (session) => {
            session.messages = session.messages.filter((m) => {
              const parsed = parseGroupMessageId(m.id);
              return (
                !parsed.isValid ||
                parsed.batchId !== batchId ||
                m.role !== message.role
              );
            });
            updateSessionStatsBasic(session);
          });

          // 获取最新的会话对象后保存
          const updatedTargetSession = chatStore.groupSessions[sessionId];
          if (updatedTargetSession) {
            await chatStore.saveSessionMessages(updatedTargetSession);
          }

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = chatStore.groupSessions[sessionId];
          if (updatedSession) {
            await updateSessionStats(updatedSession);
            chatStore.updateGroupSession(updatedSession, (session) => {});
          }
        }
      }

      showToast(
        Locale.Chat.BatchDeleteToast,
        {
          text: Locale.Chat.Revert,
          async onClick() {
            // 撤销删除操作
            for (const sessionId of Object.keys(restoreStates)) {
              const targetSession = chatStore.groupSessions[sessionId];
              if (targetSession) {
                chatStore.updateGroupSession(targetSession, (session) => {
                  session.messages = restoreStates[sessionId];
                  updateSessionStatsBasic(session);
                });

                // 获取最新的会话对象后保存
                const updatedTargetSession = chatStore.groupSessions[sessionId];
                if (updatedTargetSession) {
                  await chatStore.saveSessionMessages(updatedTargetSession);
                }

                // 异步更新包含系统提示词的完整统计信息
                const updatedSession = chatStore.groupSessions[sessionId];
                if (updatedSession) {
                  await updateSessionStats(updatedSession);
                  chatStore.updateGroupSession(updatedSession, (session) => {});
                }
              }
            }
          },
        },
        TOAST_TIMEOUT,
      );
    } catch (error) {
      console.error("[BatchDelete] Failed to delete batch:", error);
      showToast(Locale.Chat.Actions.BatchDeleteFailed);
    }
  };

  const handleSystemPromptSave = useCallback(
    async (
      content: string,
      images: string[],
      scrollTop?: number,
      selection?: { start: number; end: number },
    ) => {
      try {
        // 保存系统提示词

        // 🚀 性能优化：批量处理存储操作，避免重复的async等待
        const savePromises: Promise<any>[] = [];

        // 先保存系统提示词到存储
        if (content.trim() || images.length > 0) {
          savePromises.push(
            systemMessageStorage
              .save(session.id, {
                text: content.trim(),
                images,
                scrollTop: scrollTop || 0,
                selection: selection || { start: 0, end: 0 },
                updateAt: Date.now(),
              })
              .then((ok) => ok),
          );
        } else {
          // 如果系统提示词被清空，删除存储的系统提示词
          savePromises.push(
            systemMessageStorage.delete(session.id).then((ok) => ok),
          );
        }

        // 🚀 性能优化：先同步更新会话状态，减少UI阻塞
        updateSession((session) => {
          session.messages = session.messages.filter(
            (m) => m.role !== "system",
          );

          const newModel = determineModelForSystemPrompt(
            content.trim(),
            session.model,
            chatStore.longTextModel,
            session.isModelManuallySelected ?? false,
          );
          if (newModel) {
            session.model = newModel;
            session.isModelManuallySelected = true;
            debugLog(
              "AutoSwitch",
              `Switched to ${newModel} due to system prompt.`,
            );
          }

          // 🚀 性能优化：立即更新基础统计信息，不等待异步操作
          updateSessionStatsBasic(session);
        });

        // 🚀 性能优化：并行执行存储和统计更新，不阻塞UI
        const currentSession = chatStore.currentSession();
        savePromises.push(updateSessionStats(currentSession));

        // 等待所有操作完成
        await Promise.all(savePromises);

        // 🚀 性能优化：最后统一更新状态，减少重复渲染
        await createSessionSaveHandler(chatStore, currentSession);
      } catch (error) {
        console.error("[SystemPromptSave] 保存系统提示词失败:", error);
        // 可以在这里添加错误处理逻辑，比如显示错误提示
      }
    },
    [session.id, updateSession, chatStore],
  );

  const handleEditMessage = async (
    message: ChatMessage,
    type: "content" | "reasoningContent" = "content",
    select: { anchorText: string; extendText: string } = {
      anchorText: "",
      extendText: "",
    },
  ) => {
    if (message.streaming) return;
    setEditMessageData({ message, type, select });
    setShowEditMessageModal(true);
  };

  // --- Side Effects ---

  // Handle URL authentication code on initial load
  useEffect(() => {
    handleUrlAuthCode(searchParams, router, () => router.push("/auth"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up global handler for unauthorized API responses
  useEffect(() => {
    (window as any).__handleUnauthorized = () =>
      handleUnauthorizedResponse(() => router.push("/auth"));
    return () => {
      delete (window as any).__handleUnauthorized;
    };
  }, [router]);

  // Default to long input mode on mobile devices
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      updateSession((session) => {
        session.longInputMode = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen, session.id]);

  // Clean up stale messages and update model if necessary
  useEffect(() => {
    updateSession((session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m: any) => {
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) m.streaming = false;
          if (m.content.length === 0 && m.role !== "system") {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      const currentModel = session.model;
      const isCurrentModelValid = allModels.includes(currentModel);
      if (
        !isCurrentModelValid &&
        !session.isModelManuallySelected &&
        allModels.length > 0
      ) {
        session.model = allModels[0];
        debugLog(
          "ModelUpdate",
          `Auto-updated invalid model ${currentModel} to ${allModels[0]}`,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // 确保会话切换时自动加载消息
  useEffect(() => {
    loadSessionMessages(chatStore, session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]); // 只依赖sessionId，避免无限渲染

  // 新增：会话切换时保存滚动状态
  useEffect(() => {
    // 当会话ID变化时，保存前一个会话的滚动状态
    if (prevSessionRef.current.id && prevSessionRef.current.id !== session.id) {
      debugLog("CHAT", "🔥 会话切换，保存前一个会话的滚动状态", {
        previousSessionId: prevSessionRef.current.id,
        currentSessionId: session.id,
      });

      // 这里可以添加保存前一个会话滚动状态的逻辑
      // 由于MessageList组件已经处理了滚动状态保存，这里主要是日志记录
    }
  }, [session.id]);

  // --- Render Logic ---
  return (
    <>
      <div className={styles.chat} key={session.id}>
        <ChatHeader
          sessionTitle={session.title}
          messageCount={session.messageCount}
          onEditSystemMessageClick={async () => {
            let systemData = await systemMessageStorage.get(session.id);
            setSystemPromptData(systemData);
            setShowSystemPromptEdit(true);
          }}
          onEditSessionClick={() => setIsEditingSession(true)}
          onExportClick={() => setShowExport(true)}
          onDeleteSessionClick={async () => {
            // 对于组内会话，需要特殊处理删除逻辑
            if (session.groupId) {
              await chatStore.deleteGroupSession(session.id);
            } else {
              chatStore.deleteSession(chatStore.currentSessionIndex);
            }
          }}
          onDeleteGroupClick={async () => {
            // 删除整个组
            if (session.groupId) {
              await chatStore.deleteGroup(session.groupId);
            }
          }}
          hasGroupId={!!session.groupId}
        />
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <MessageList
              messages={messages}
              onResend={onResend}
              onDelete={onDelete}
              onUserStop={onUserStop}
              onBranch={handleBranch}
              onBatchApply={handleBatchApply}
              onBatchDelete={handleBatchDelete}
              onEditMessage={handleEditMessage}
              handleTripleClick={handleTripleClick}
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
              setHitBottom={setHitBottom}
            />
            <ChatInputPanel
              onSubmit={handleSubmit}
              sessionId={session.id}
              autoFocus={autoFocus}
              longInputMode={session.longInputMode}
            />
          </div>
        </div>
      </div>

      {/* --- Modals --- */}
      {isEditingSession && (
        <SessionEditor onClose={() => setIsEditingSession(false)} />
      )}
      {showSystemPromptEdit && (
        <SystemPromptEditDialog
          onClose={() => setShowSystemPromptEdit(false)}
          sessionId={session.id}
          onSave={handleSystemPromptSave}
          initialContent={systemPromptData.text}
          initialImages={systemPromptData.images}
          initialScrollTop={systemPromptData.scrollTop}
          initialSelection={systemPromptData.selection}
        />
      )}
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}
      {showEditMessageModal && editMessageData && (
        <MessageEditDialog
          onClose={() => setShowEditMessageModal(false)}
          initialContent={
            editMessageData.type === "content"
              ? getMessageTextContent(editMessageData.message)
              : getMessageTextReasoningContent(editMessageData.message)
          }
          initialImages={getMessageImages(editMessageData.message)}
          onSave={(newContent, newImages, retryOnConfirm) => {
            updateSession((session) => {
              const m = session.messages.find(
                (m: any) => m.id === editMessageData.message.id,
              );
              if (m) {
                if (editMessageData.type === "content") {
                  if (newImages.length > 0) {
                    m.content = [
                      { type: "text", text: newContent },
                      ...newImages.map((url) => ({
                        type: "image_url" as const,
                        image_url: { url },
                      })),
                    ] as any; // Type assertion to match MultimodalContent
                  } else {
                    m.content = newContent;
                  }
                } else if (editMessageData.type === "reasoningContent") {
                  m.reasoningContent = newContent;
                }
              }
            });
            if (retryOnConfirm && editMessageData.message.role === "user") {
              onResend(editMessageData.message);
            }
          }}
          title={Locale.Chat.Actions.Edit}
          textareaRef={messageEditRef}
          message={editMessageData.message}
          onSmartPosition={createSmartPositionCallback(
            editMessageData.select,
            editMessageData.type,
            editMessageData.message,
          )}
        />
      )}
    </>
  );
});

/**
 * A wrapper component that forces the Chat component to re-mount when the session changes.
 * This is a clean way to reset all component state when switching conversations.
 */
// 将选择器提取到组件外部，避免每次渲染时重新创建
const selectCurrentSessionId = (state: any) => {
  const {
    chatListView,
    chatListGroupView,
    groups,
    currentGroupIndex,
    groupSessions,
    sessions,
    currentSessionIndex,
  } = state;

  // 普通会话模式：从 sessions 数组获取
  if (chatListView === "sessions") {
    if (
      sessions.length === 0 ||
      currentSessionIndex < 0 ||
      currentSessionIndex >= sessions.length
    ) {
      return null;
    }
    return sessions[currentSessionIndex].id;
  }

  // 组会话模式：根据组内视图决定返回哪个会话
  if (chatListView === "groups") {
    // 组内会话模式：返回当前组的当前会话
    if (chatListGroupView === "group-sessions") {
      const currentGroup = groups[currentGroupIndex];
      if (currentGroup && currentGroup.sessionIds.length > 0) {
        const currentSessionId =
          currentGroup.sessionIds[currentGroup.currentSessionIndex];
        const session = groupSessions[currentSessionId];
        if (session) {
          return session.id;
        }
      }
    }

    // 组列表模式：返回当前组的第一个会话
    if (chatListGroupView === "groups") {
      const currentGroup = groups[currentGroupIndex];
      if (currentGroup && currentGroup.sessionIds.length > 0) {
        const firstSessionId = currentGroup.sessionIds[0];
        const session = groupSessions[firstSessionId];
        if (session) {
          return session.id;
        }
      }
    }
  }

  return null;
};

export function ChatPage() {
  const isAppReady = useAppReadyGuard();

  // 只订阅当前会话的 ID，不订阅 currentSessionIndex 和 sessions 数组
  // 使用稳定的选择器函数，避免重新创建
  // 使用useShallow替代弃用的equalityFn参数
  const currentSessionId = useChatStore(
    useShallow((state) => selectCurrentSessionId(state)),
  );

  const chatListView = useChatStore((state) => state.chatListView);

  // 追踪重新渲染次数和 sessionId 变化
  const renderCount = React.useRef(0);
  const lastSessionIdRef = React.useRef<string | null>(null);
  const sessionIdChanged = lastSessionIdRef.current !== currentSessionId;
  const previousSessionId = lastSessionIdRef.current;

  renderCount.current += 1;

  // 在 useEffect 中更新，确保在下次渲染时才生效
  React.useEffect(() => {
    lastSessionIdRef.current = currentSessionId;
  });

  // 🔥 确保应用完全准备好后再渲染聊天界面
  if (!isAppReady) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">正在准备聊天数据...</p>
        </div>
      </div>
    );
  }

  // 如果没有会话，显示空状态
  if (!currentSessionId) {
    const isGroupMode = chatListView === "groups";
    return (
      <div className={styles["chat-empty"]}>
        <div className={styles["chat-empty-card"]}>
          <div className={styles["chat-empty-icon"]}>
            {isGroupMode ? (
              <svg viewBox="0 0 16 16" fill="none">
                <rect
                  x="2"
                  y="3"
                  width="9"
                  height="9"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="5"
                  y="6"
                  width="9"
                  height="9"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5C4.69 1.5 2 3.96 2 7c0 1.2.4 2.32 1.08 3.22L2 14l3.5-1.5c.77.32 1.62.5 2.5.5 3.31 0 6-2.46 6-5.5S11.31 1.5 8 1.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            )}
          </div>
          <h3 className={styles["chat-empty-title"]}>
            {isGroupMode ? "暂无组会话" : "暂无会话"}
          </h3>
          <p className={styles["chat-empty-desc"]}>
            {isGroupMode
              ? "将文件（图片 jpg/png/gif/…、文档 txt/md/json/… 等格式）拖拽到本区域，即可创建组会话批量处理"
              : "点击左侧「新会话」按钮，开始与 AI 对话"}
          </p>
        </div>
      </div>
    );
  }

  debugLog("CHAT_PAGE", "🔥 ChatPage 重新渲染", {
    sessionId: currentSessionId,
    previousSessionId,
    renderCount: renderCount.current,
    sessionIdChanged,
    timestamp: Date.now(),
  });

  return <Chat key={currentSessionId} />;
}
