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
import { showToast } from "./ui-lib";
import { useContextMenu } from "./context-menu";
import sidebarStyles from "../styles/sidebar.module.scss";
import type { SessionScrollBookmark } from "../types/scroll";
import { nanoid } from "nanoid";

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
  /** 分享页只读：展示系统消息（有内容时）、无操作、不依赖 store 会话 */
  readOnly?: boolean;
  /** 分享页的 shareId（如 3vQZpn），用于按链接持久化滚动位置，与鉴权会话数据隔离（key 为 share_${shareId}） */
  shareId?: string;
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

/** readOnly 时使用稳定引用，避免 getSnapshot 每次返回新对象导致无限循环 */
const EMPTY_SESSION_SNAPSHOT = {
  messages: [] as any[],
  sessionId: null as string | null,
};

function hasMessageContent(message: RenderMessage): boolean {
  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }
  if (Array.isArray(message.content)) {
    return message.content.some(
      (p) =>
        (p.type === "text" && (p.text?.trim() ?? "").length > 0) ||
        (p.type === "image_url" && p.image_url?.url),
    );
  }
  return false;
}

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
  readOnly = false,
  shareId,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const contextMenu = useContextMenu();
  const [bookmarks, setBookmarks] = useState<SessionScrollBookmark[]>([]);
  const [contextMenuMode, setContextMenuMode] = useState<"mark" | "remove">(
    "mark",
  );
  const [contextMenuBookmarkId, setContextMenuBookmarkId] = useState<
    string | null
  >(null);
  const isMobileScreen = useMobileScreen();

  const messagesData = useChatStore(
    useShallow(
      readOnly ? () => EMPTY_SESSION_SNAPSHOT : selectCurrentSessionMessages,
    ),
  );

  const chatStore = React.useMemo(() => useChatStore.getState(), []);
  const currentSession = readOnly ? null : chatStore.currentSession();

  // 分享页按 shareId 隔离存储（share_${shareId}），与鉴权会话 ID 不混用
  const scrollKey = readOnly
    ? shareId
      ? `share_${shareId}`
      : "share"
    : currentSession?.id || "";
  const { saveScrollState, restoreScrollState } = useScrollState(scrollKey);

  // 书签是用户意图，与自动保存的最近滚动状态分开存储。
  useEffect(() => {
    let active = true;
    setBookmarks([]);
    if (!scrollKey || readOnly) return;
    import("../store/scroll").then(({ scrollBookmarkStorage }) =>
      scrollBookmarkStorage.getAll(scrollKey).then((saved) => {
        if (active) setBookmarks(saved);
      }),
    );
    return () => {
      active = false;
    };
  }, [scrollKey, readOnly]);

  // 添加调试信息
  React.useEffect(() => {
    debugLog("MESSAGE_LIST", "消息列表组件渲染", {
      propMessagesLength: messages.length,
      storeMessagesLength: messagesData.messages.length,
      sessionId: messagesData.sessionId,
      timestamp: Date.now(),
    });
  }, [messagesData.sessionId, messagesData.messages.length, messages.length]); // 包含所有必要的依赖

  // 分享页首次打开默认从顶部开始；会话页从底部
  const [msgRenderIndex, setMsgRenderIndex] = useState(() =>
    readOnly && shareId ? 0 : Math.max(0, messages.length - CHAT_PAGE_SIZE),
  );
  const [messageHeights, setMessageHeights] = useState<{
    [key: string]: number;
  }>({});
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const prevScrollKey = useRef<string | undefined>(undefined);

  // 辅助函数：重置到最后一页
  const resetToLastPage = useCallback(() => {
    const newIndex = Math.max(0, messages.length - CHAT_PAGE_SIZE);
    setMsgRenderIndex(newIndex);
    return newIndex;
  }, [messages.length]);

  // 🔧 会话或分享页加载时恢复滚动状态；分享页无保存状态时保持在顶部
  useEffect(() => {
    const sessionIdForRestore = readOnly ? scrollKey : messagesData.sessionId;
    if (!sessionIdForRestore || prevScrollKey.current === sessionIdForRestore) {
      return;
    }

    debugLog("MESSAGE_LIST", "开始恢复滚动状态", {
      scrollKey: sessionIdForRestore,
      prevScrollKey: prevScrollKey.current,
    });

    isRestoringRef.current = true;
    prevScrollKey.current = sessionIdForRestore;

    restoreScrollState()
      .then((scrollState) => {
        if (scrollState) {
          setMsgRenderIndex(scrollState.messageIndex);
          setAutoScroll(false);
          setTimeout(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollState.scrollTop;
              debugLog("MESSAGE_LIST", "滚动位置已恢复", {
                scrollKey: sessionIdForRestore,
                messageIndex: scrollState.messageIndex,
                scrollTop: scrollState.scrollTop,
              });
            }
          }, 100);
        } else {
          // 分享页无保存状态：保持在顶部；会话页：重置到最后一页
          if (sessionIdForRestore.startsWith("share_")) {
            setMsgRenderIndex(0);
            setAutoScroll(false);
            setTimeout(() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }, 100);
          } else {
            resetToLastPage();
          }
        }
      })
      .catch((error) => {
        debugLog("MESSAGE_LIST", "恢复滚动状态失败", {
          scrollKey: sessionIdForRestore,
          error,
        });
        if (sessionIdForRestore.startsWith("share_")) {
          setMsgRenderIndex(0);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
      })
      .finally(() => {
        isRestoringRef.current = false;
      });
  }, [
    scrollKey,
    readOnly,
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

  const persistBookmarks = useCallback(
    async (nextBookmarks: SessionScrollBookmark[]) => {
      if (!scrollKey) return false;
      const { scrollBookmarkStorage } = await import("../store/scroll");
      return scrollBookmarkStorage.saveAll(scrollKey, nextBookmarks);
    },
    [scrollKey],
  );

  // 消息插入/删除后维持书签在全会话导航轨道上的正确索引。
  useEffect(() => {
    if (!bookmarks.length || messages.length === 0) return;
    let changed = false;
    const updated = bookmarks.map((bookmark) => {
      const currentIndex = messages.findIndex(
        (message) => message.id === bookmark.messageId,
      );
      if (currentIndex < 0 || currentIndex === bookmark.messageIndex)
        return bookmark;
      changed = true;
      return { ...bookmark, messageIndex: currentIndex };
    });
    if (changed) {
      setBookmarks(updated);
      void persistBookmarks(updated);
    }
  }, [bookmarks, messages, persistBookmarks]);

  const captureBookmark = useCallback(
    async (replaceBookmarkId?: string) => {
      const viewport = scrollRef.current;
      if (!viewport || !scrollKey) return;
      const bookmarkToReplace = replaceBookmarkId
        ? bookmarks.find((bookmark) => bookmark.id === replaceBookmarkId)
        : undefined;
      if (replaceBookmarkId && !bookmarkToReplace) {
        contextMenu.close();
        return;
      }
      const viewportRect = viewport.getBoundingClientRect();
      const renderedElements = new Map(
        Array.from(
          viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
        ).map((element) => [element.dataset.messageId, element]),
      );
      const visible = messages
        .map((message, index) => {
          const element = renderedElements.get(message.id);
          if (!element) return null;
          return {
            message,
            index,
            element,
            rect: element.getBoundingClientRect(),
          };
        })
        .find(
          (item) =>
            item &&
            item.rect.bottom > viewportRect.top + 2 &&
            item.rect.top < viewportRect.bottom,
        );

      if (!visible?.message.id) return;
      const nextBookmark: SessionScrollBookmark = {
        sessionId: scrollKey,
        id: bookmarkToReplace?.id ?? nanoid(),
        messageId: visible.message.id,
        messageIndex: visible.index,
        viewportOffset: visible.rect.top - viewportRect.top,
        messageProgress: Math.max(
          0,
          Math.min(
            1,
            (viewportRect.top - visible.rect.top) /
              Math.max(1, visible.rect.height),
          ),
        ),
        createdAt: Date.now(),
      };
      const nextBookmarks = bookmarkToReplace
        ? bookmarks.map((bookmark) =>
            bookmark.id === bookmarkToReplace.id ? nextBookmark : bookmark,
          )
        : [...bookmarks, nextBookmark];
      setBookmarks(nextBookmarks);
      contextMenu.close();
      const saved = await persistBookmarks(nextBookmarks);
      if (saved) {
        showToast(bookmarkToReplace ? "标记已更新" : "已标记当前位置");
      } else {
        setBookmarks(bookmarks);
        debugLog("MESSAGE_LIST", "阅读书签保存失败", nextBookmark);
      }
    },
    [messages, scrollKey, persistBookmarks, contextMenu, bookmarks],
  );

  const findMessageElement = useCallback((messageId: string) => {
    return Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ??
        [],
    ).find((item) => item.dataset.messageId === messageId);
  }, []);

  const jumpToMessage = useCallback(
    (
      messageId: string,
      messageIndex: number,
      viewportOffset: number,
      alignLastMessage = false,
    ) => {
      const viewport = scrollRef.current;
      if (!viewport || messages.length === 0) return;
      const safeIndex = Math.max(
        0,
        Math.min(messages.length - 1, messageIndex),
      );
      const maxStart = Math.max(0, messages.length - CHAT_PAGE_SIZE);
      const newStart = Math.max(
        0,
        Math.min(maxStart, safeIndex - CHAT_PAGE_SIZE),
      );
      setAutoScroll(false);
      setHitBottom(false);
      setMsgRenderIndex(newStart);
      programmaticScrollRef.current = true;

      const alignMessage = () => {
        const currentViewport = scrollRef.current;
        const element = findMessageElement(messageId);
        if (!currentViewport || !element) {
          programmaticScrollRef.current = false;
          return;
        }

        const viewportRect = currentViewport.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const scrollDelta = elementRect.top - viewportRect.top - viewportOffset;

        if (alignLastMessage) {
          const targetScrollTop = currentViewport.scrollTop + scrollDelta;
          const maxScrollTop =
            currentViewport.scrollHeight - currentViewport.clientHeight;

          // 短末条消息无法在不添加尾部空白的情况下顶端对齐；此时停在真实内容末端，
          // 让消息靠近视口底部。较长消息仍按要求顶端对齐。
          currentViewport.scrollTop =
            targetScrollTop <= maxScrollTop ? targetScrollTop : maxScrollTop;
        } else {
          currentViewport.scrollTop += scrollDelta;
        }
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      };

      requestAnimationFrame(() => requestAnimationFrame(alignMessage));
    },
    [messages, setAutoScroll, setHitBottom, findMessageElement],
  );

  const jumpToBookmark = useCallback(
    (bookmark: SessionScrollBookmark) => {
      if (messages.length === 0) return;
      const currentIndex = messages.findIndex(
        (message) => message.id === bookmark.messageId,
      );
      const fallbackIndex = Math.max(
        0,
        Math.min(messages.length - 1, bookmark.messageIndex),
      );
      const targetIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
      const target = messages[targetIndex];
      if (!target?.id) return;

      const adjustedBookmark =
        target.id === bookmark.messageId &&
        targetIndex === bookmark.messageIndex
          ? bookmark
          : { ...bookmark, messageId: target.id, messageIndex: targetIndex };
      if (adjustedBookmark !== bookmark) {
        const updated = bookmarks.map((item) =>
          item.id === bookmark.id ? adjustedBookmark : item,
        );
        setBookmarks(updated);
        void persistBookmarks(updated);
      }
      jumpToMessage(target.id, targetIndex, adjustedBookmark.viewportOffset);
    },
    [bookmarks, messages, jumpToMessage, persistBookmarks],
  );

  const jumpToLastMessage = useCallback(() => {
    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];
    if (!lastMessage?.id) return;
    jumpToMessage(lastMessage.id, lastIndex, 0, true);
  }, [messages, jumpToMessage]);

  const removeBookmark = useCallback(async () => {
    if (!contextMenuBookmarkId) return;
    const previousBookmarks = bookmarks;
    const nextBookmarks = bookmarks.filter(
      (item) => item.id !== contextMenuBookmarkId,
    );
    setBookmarks(nextBookmarks);
    contextMenu.close();
    const { scrollBookmarkStorage } = await import("../store/scroll");
    const removed = await scrollBookmarkStorage.remove(
      scrollKey,
      contextMenuBookmarkId,
    );
    if (removed) {
      showToast("标记已删除");
    } else {
      setBookmarks(previousBookmarks);
      debugLog("MESSAGE_LIST", "阅读书签删除失败", { scrollKey });
    }
  }, [bookmarks, contextMenu, contextMenuBookmarkId, scrollKey]);

  const openViewportContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, button, a, [contenteditable='true'], iframe, video, audio",
        )
      ) {
        return;
      }
      if (window.getSelection()?.toString().trim()) return;
      event.preventDefault();
      event.stopPropagation();
      setContextMenuMode("mark");
      setContextMenuBookmarkId(null);
      contextMenu.openAtEvent(event);
    },
    [contextMenu],
  );

  const openBookmarkContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, bookmarkId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenuMode("remove");
      setContextMenuBookmarkId(bookmarkId);
      contextMenu.openAtEvent(event);
    },
    [contextMenu],
  );

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (!programmaticScrollRef.current) {
      if (isTouchTopEdge && !isTouchBottomEdge) {
        updateMsgRenderIndex(prevPageMsgIndex);
      } else if (isTouchBottomEdge) {
        updateMsgRenderIndex(nextPageMsgIndex);
      }
    }

    if (!programmaticScrollRef.current) {
      setHitBottom(isHitBottom);
      setAutoScroll(isHitBottom);
    }

    // 保存滚动状态（会话页与分享页按 scrollKey 隔离存储）
    if (scrollKey) {
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
    <div className={styles["chat-message-region"]}>
      <div
        className={styles["chat-body"]}
        ref={scrollRef}
        onScroll={(e) => onChatBodyScroll(e.currentTarget)}
        onContextMenu={readOnly ? undefined : openViewportContextMenu}
        onMouseDown={() => {
          const activeElement = document.activeElement as HTMLElement;
          if (activeElement && activeElement.tagName === "TEXTAREA") {
            activeElement.blur();
          }
        }}
        onTouchStart={() => {
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

          if (isSystem) {
            if (!readOnly) return null;
            if (!hasMessageContent(message)) return null;
          }

          return (
            <ChatMessageItem
              key={message.id}
              message={message}
              index={msgRenderIndex + i}
              isUser={isUser}
              showActions={showActions}
              readOnly={readOnly}
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

      {!readOnly && messages.length > 0 && (
        <div className={styles["scroll-marker-rail"]} aria-label="会话导航标记">
          {bookmarks.map((bookmark, index) => {
            const position =
              ((bookmark.messageIndex + bookmark.messageProgress) /
                Math.max(1, messages.length)) *
              100;
            const nearbyCount = bookmarks
              .slice(0, index)
              .filter(
                (previous) =>
                  Math.abs(
                    previous.messageIndex +
                      previous.messageProgress -
                      bookmark.messageIndex -
                      bookmark.messageProgress,
                  ) <= Math.max(1, messages.length * 0.018),
              ).length;
            return (
              <button
                key={bookmark.id}
                type="button"
                className={`${styles["scroll-marker"]} ${styles["scroll-marker-bookmark"]}`}
                style={{
                  top: `calc(${position}% + ${nearbyCount * (isMobileScreen ? 7 : 5)}px)`,
                  marginTop:
                    bookmark.messageIndex === messages.length - 1
                      ? isMobileScreen
                        ? -20
                        : -16
                      : 0,
                }}
                title={`返回阅读标记 ${index + 1}；右键删除`}
                aria-label={`返回阅读标记 ${index + 1}；右键打开删除菜单`}
                onClick={() => jumpToBookmark(bookmark)}
                onContextMenu={(event) =>
                  openBookmarkContextMenu(event, bookmark.id)
                }
              >
                <span aria-hidden="true">◆</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`${styles["scroll-marker"]} ${styles["scroll-marker-last"]}`}
            style={{ top: "100%" }}
            title="跳到最后一条消息的顶部"
            aria-label="跳到最后一条消息的顶部"
            onClick={jumpToLastMessage}
          >
            <span aria-hidden="true">●</span>
          </button>
        </div>
      )}

      {contextMenu.render(
        <>
          {contextMenuMode === "remove" && (
            <div
              className={sidebarStyles["search-context-item"]}
              onClick={() => {
                void captureBookmark(contextMenuBookmarkId ?? undefined);
              }}
            >
              更新为当前位置
            </div>
          )}
          <div
            className={sidebarStyles["search-context-item"]}
            onClick={() => {
              if (contextMenuMode === "remove") {
                void removeBookmark();
              } else {
                void captureBookmark();
              }
            }}
          >
            {contextMenuMode === "remove" ? "删除标记" : "标记当前位置"}
          </div>
        </>,
      )}
    </div>
  );
});
