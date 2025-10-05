import React, {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { ChatMessage, useChatStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { ChatMessageItem } from "./chat-message-item";
import { useMobileScreen } from "../utils";
import { CHAT_PAGE_SIZE } from "../constant";
import { useScrollState } from "../hooks/use-scroll-state";
import styles from "../styles/chat.module.scss";
import { createModuleLogger } from "../utils/logger";

const messageListLogger = createModuleLogger("MESSAGE_LIST");

const debugLog = (category: string, message: string, data?: any) => {
  messageListLogger.debug(category, message, data);
};

type RenderMessage = ChatMessage & { preview?: boolean };

interface MessageListProps {
  messages: RenderMessage[];
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  onBatchApply: (message: ChatMessage) => void; // 新增：批量应用回调
  onBatchDelete: (message: ChatMessage) => void; // 新增：批量删除回调
  onEditMessage: (
    message: ChatMessage,
    type?: "content" | "reasoningContent",
    select?: { anchorText: string; extendText: string },
  ) => void;
  handleTripleClick: (
    e: React.MouseEvent,
    callback: (select: { anchorText: string; extendText: string }) => void,
  ) => void;
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
  setHitBottom: (hitBottom: boolean) => void;
}

// 创建选择器：只订阅当前会话的消息列表
const selectCurrentSessionMessages = (state: any) => {
  const currentSession = state.sessions[state.currentSessionIndex];
  if (!currentSession) return { messages: [], sessionId: null };
  return {
    messages: currentSession.messages || [],
    sessionId: currentSession.id,
  };
};

export const MessageList = React.memo(function MessageList({
  messages,
  onResend,
  onDelete,
  onUserStop,
  onBranch,
  onBatchApply,
  onBatchDelete,
  onEditMessage,
  handleTripleClick,
  autoScroll,
  setAutoScroll,
  setHitBottom,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobileScreen = useMobileScreen();

  // 独立订阅消息相关状态
  const messagesData = useChatStore(useShallow(selectCurrentSessionMessages));

  // 保留 chatStore 用于调用方法
  const chatStore = React.useMemo(() => useChatStore.getState(), []);
  const currentSession = chatStore.currentSession();

  // 新增：滚动状态管理
  const { saveScrollState, restoreScrollState, isRestoring } = useScrollState(
    currentSession?.id || "",
  );

  // 添加调试信息
  React.useEffect(() => {
    debugLog("MESSAGE_LIST", "消息列表组件渲染", {
      propMessagesLength: messages.length,
      storeMessagesLength: messagesData.messages.length,
      sessionId: messagesData.sessionId,
      timestamp: Date.now(),
    });
  }, [messagesData, messages.length]);

  const [msgRenderIndex, setMsgRenderIndex] = useState(
    Math.max(0, messages.length - CHAT_PAGE_SIZE),
  );
  const [messageHeights, setMessageHeights] = useState<{
    [key: string]: number;
  }>({});
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const prevSessionId = useRef<string | undefined>(undefined);

  // 辅助函数：重置到最后一页
  const resetToLastPage = useCallback(() => {
    const newIndex = Math.max(0, messages.length - CHAT_PAGE_SIZE);
    setMsgRenderIndex(newIndex);
    return newIndex;
  }, [messages.length]);

  // 🔧 优化：每次会话加载时都尝试恢复滚动状态
  useEffect(() => {
    const currentSessionId = messagesData.sessionId;

    // 只有当会话ID存在且与之前不同时才恢复
    if (currentSessionId && prevSessionId.current !== currentSessionId) {
      debugLog("MESSAGE_LIST", "会话加载，开始恢复滚动状态", {
        sessionId: currentSessionId,
        prevSessionId: prevSessionId.current,
      });

      // 设置恢复标记
      isRestoringRef.current = true;

      restoreScrollState()
        .then((scrollState) => {
          if (scrollState) {
            // 恢复分片状态
            setMsgRenderIndex(scrollState.messageIndex);
            // 临时禁用自动滚动，避免覆盖恢复的位置
            setAutoScroll(false);

            // 延迟恢复滚动位置，确保DOM已更新
            setTimeout(() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollState.scrollTop;
                debugLog("MESSAGE_LIST", "滚动位置已恢复", {
                  sessionId: currentSessionId,
                  messageIndex: scrollState.messageIndex,
                  scrollTop: scrollState.scrollTop,
                });
              }
            }, 100);
          } else {
            // 没有保存的滚动状态，重置到最后一页
            const newIndex = resetToLastPage();
            debugLog("MESSAGE_LIST", "无滚动状态，重置到最后一页", {
              sessionId: currentSessionId,
              newIndex,
            });
          }
        })
        .catch((error) => {
          debugLog("MESSAGE_LIST", "恢复滚动状态失败", {
            sessionId: currentSessionId,
            error,
          });
        })
        .finally(() => {
          // 统一清除恢复标记
          isRestoringRef.current = false;
        });

      // 更新前一个会话ID
      prevSessionId.current = currentSessionId;
    }
  }, [
    messagesData.sessionId,
    messages.length,
    restoreScrollState,
    setAutoScroll,
    resetToLastPage,
  ]);

  // 只在消息数量增加时重置到最后一页（新消息到达）
  const prevMessageLength = useRef(messages.length);
  const isRestoringRef = useRef(false); // 新增：标记是否正在恢复滚动状态

  useEffect(() => {
    if (messages.length > prevMessageLength.current) {
      // 只有消息增加时才重置到最后一页；仅在允许自动滚动且不在恢复状态时才跳转
      if (autoScroll && !isRestoringRef.current) {
        const newIndex = resetToLastPage();
        debugLog("MESSAGE_LIST", "消息增加，重置到最后一页", {
          newIndex,
          messagesLength: messages.length,
        });
      }
    }
    prevMessageLength.current = messages.length;
  }, [messages.length, autoScroll, resetToLastPage]);

  function updateMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(messages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    setMsgRenderIndex(newIndex);
  }

  const renderMessages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      messages.length,
    );
    return messages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, messages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      updateMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      updateMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);

    // 新增：保存滚动状态
    if (currentSession?.id) {
      saveScrollState(e.scrollTop, msgRenderIndex, e.clientHeight);
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && !isRestoringRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight);
        }
      });
    }
  });

  // 使用 useEffect 和 ResizeObserver 来监听消息高度变化
  useEffect(() => {
    const observers = new Map<string, ResizeObserver>();

    // 清理函数
    const cleanup = () => {
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
    };

    // 为每个消息创建 ResizeObserver
    Object.entries(messageRefs.current).forEach(([messageId, element]) => {
      if (!element) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const height = entry.contentRect.height;
          setMessageHeights((prev) => {
            // 只有当高度真正改变时才更新状态
            if (prev[messageId] === height) return prev;
            return {
              ...prev,
              [messageId]: height,
            };
          });
        }
      });

      observer.observe(element);
      observers.set(messageId, observer);
    });

    return cleanup;
  }, [messages.length]); // 只在消息列表长度变化时重新设置观察者

  return (
    <div
      className={styles["chat-body"]}
      ref={scrollRef}
      onScroll={(e) => onChatBodyScroll(e.currentTarget)}
      onMouseDown={() => {
        // 移除对 inputRef 的依赖，改为通用的失焦处理
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && activeElement.tagName === "TEXTAREA") {
          activeElement.blur();
        }
      }}
      onTouchStart={() => {
        // 移除对 inputRef 的依赖，改为通用的失焦处理
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && activeElement.tagName === "TEXTAREA") {
          activeElement.blur();
        }
        setAutoScroll(false);
      }}
    >
      {renderMessages.map((message, i) => {
        const isUser = message.role === "user";
        const isSystem = message.role === "system";
        const showActions = !(
          message.preview ||
          (message.content.length === 0 && !message.reasoningContent)
        );

        // 系统级提示词在会话界面中隐藏
        if (isSystem) {
          return null;
        }

        return (
          <ChatMessageItem
            key={message.id}
            message={message}
            index={i}
            isUser={isUser}
            showActions={showActions}
            messageRefs={messageRefs}
            scrollRef={scrollRef}
            messageHeights={messageHeights}
            onResend={onResend}
            onDelete={onDelete}
            onUserStop={onUserStop}
            onBranch={onBranch}
            onBatchApply={onBatchApply}
            onBatchDelete={onBatchDelete}
            onEditMessage={onEditMessage}
            handleTripleClick={handleTripleClick}
          />
        );
      })}
    </div>
  );
});
