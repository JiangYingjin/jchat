import React, { useRef, useEffect, useMemo, useState } from "react";
import { ChatMessage, useChatStore } from "../store";
import { ChatMessageItem } from "./chat-message-item";
import { useMobileScreen } from "../utils";
import { CHAT_PAGE_SIZE } from "../constant";
import styles from "../styles/chat.module.scss";

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

export function MessageList({
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
  const chatStore = useChatStore();
  const currentSession = chatStore.currentSession();

  const [msgRenderIndex, setMsgRenderIndex] = useState(
    Math.max(0, messages.length - CHAT_PAGE_SIZE),
  );
  const [messageHeights, setMessageHeights] = useState<{
    [key: string]: number;
  }>({});
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const prevSessionId = useRef<string | undefined>(currentSession?.id);

  // 🔧 修复：监听会话ID变化，重置分页状态
  useEffect(() => {
    const currentSessionId = currentSession?.id;
    if (prevSessionId.current !== currentSessionId) {
      // 会话切换时，重置到最后一页
      const newIndex = Math.max(0, messages.length - CHAT_PAGE_SIZE);
      setMsgRenderIndex(newIndex);
      prevSessionId.current = currentSessionId;
    }
  }, [currentSession?.id, messages.length]);

  // 只在消息数量增加时重置到最后一页（新消息到达）
  const prevMessageLength = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessageLength.current) {
      // 只有消息增加时才重置到最后一页；仅在允许自动滚动时才跳转
      if (autoScroll) {
        const newIndex = Math.max(0, messages.length - CHAT_PAGE_SIZE);
        setMsgRenderIndex(newIndex);
      }
    }
    prevMessageLength.current = messages.length;
  }, [messages.length, autoScroll]);

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
  };

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll) {
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
}
