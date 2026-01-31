import React, { Fragment, RefObject } from "react";
import { ChatMessage, useChatStore } from "../store";
import { getMessageTextContent, getMessageImages } from "../utils";
import { MultimodalContent } from "../client/api";
import { Markdown } from "./markdown";
import { ThinkingContent } from "./thinking-content";
import { MessageActions } from "./message-actions";
import { MessageMetrics } from "./message-metrics";
import styles from "../styles/chat.module.scss";
import { handleMergeCopy } from "../utils/group";

type RenderMessage = ChatMessage & { preview?: boolean };

interface ChatMessageItemProps {
  message: RenderMessage;
  index: number;
  isUser: boolean;
  showActions: boolean;
  messageRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>;
  scrollRef: RefObject<HTMLDivElement | null>;
  messageHeights: { [key: string]: number };
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  onBatchApply: (message: ChatMessage) => void;
  onBatchDelete: (message: ChatMessage) => void;
  onEditMessage: (
    message: ChatMessage,
    type?: "content" | "reasoningContent",
    select?: { anchorText: string; extendText: string },
  ) => void;
  handleTripleClick: (
    e: React.MouseEvent,
    callback: (select: { anchorText: string; extendText: string }) => void,
  ) => void;
  /** 分享页只读：无操作按钮、无双击/三击编辑 */
  readOnly?: boolean;
}

export function ChatMessageItem({
  message,
  index,
  isUser,
  showActions,
  messageRefs,
  scrollRef,
  messageHeights,
  onResend,
  onDelete,
  onUserStop,
  onBranch,
  onBatchApply,
  onBatchDelete,
  onEditMessage,
  handleTripleClick,
  readOnly = false,
}: ChatMessageItemProps) {
  const chatStore = useChatStore();
  const session = readOnly ? null : chatStore.currentSession();
  const showBranch = session ? !session?.groupId : false;
  const effectiveShowActions = readOnly ? false : showActions;

  return (
    <Fragment key={message.id}>
      <div
        className={
          isUser ? styles["chat-message-user"] : styles["chat-message"]
        }
      >
        <div
          className={
            styles["chat-message-container"] +
            " " +
            (isUser
              ? styles["chat-message-container-user"]
              : styles["chat-message-container-assistant"])
          }
        >
          <div className={styles["chat-message-header"]}>
            {!isUser && (
              <div className={styles["chat-model-name"]}>
                {message.model ?? (message.role === "system" ? "系统" : "模型")}
              </div>
            )}

            {effectiveShowActions && (
              <div className={styles["chat-message-actions"]}>
                <MessageActions
                  message={message}
                  onResend={onResend}
                  onDelete={onDelete}
                  onUserStop={onUserStop}
                  onBranch={onBranch}
                  onBatchApply={onBatchApply}
                  onBatchDelete={onBatchDelete}
                  index={index}
                  showBranch={showBranch}
                  showBatchApply={!!session?.groupId}
                  showBatchDelete={!!session?.groupId}
                  showDelete={!session?.groupId}
                  showMergeCopy={
                    !!session?.groupId && message.role === "assistant"
                  }
                  onMergeCopy={(msg, format) =>
                    session
                      ? handleMergeCopy(msg, session, chatStore, format)
                      : undefined
                  }
                />
              </div>
            )}
          </div>

          {!isUser && message.reasoningContent && (
            <ThinkingContent
              message={message}
              onDoubleClick={
                readOnly
                  ? undefined
                  : (e) =>
                      handleTripleClick(e, (select) => {
                        onEditMessage(message, "reasoningContent", select);
                      })
              }
            />
          )}

          <div
            className={styles["chat-message-item"]}
            ref={(el) => {
              if (message.id) {
                messageRefs.current[message.id] = el;
              }
            }}
            {...(readOnly
              ? {}
              : {
                  onDoubleClick: async () => {
                    if (message.streaming) return;
                    if (isUser) onEditMessage(message, "content");
                  },
                  onClick: (e: React.MouseEvent) => {
                    if (!isUser) {
                      handleTripleClick(e, (select) =>
                        onEditMessage(message, "content", select),
                      );
                    }
                  },
                })}
          >
            {Array.isArray(message.content) ? (
              message.content.map((content, contentIndex) => (
                <Fragment key={contentIndex}>
                  {content.type === "text" && (
                    <Markdown
                      key={
                        message.streaming ? "loading" : `text-${contentIndex}`
                      }
                      content={content.text || ""}
                      loading={
                        (message.preview || message.streaming) &&
                        !content.text &&
                        !isUser &&
                        (message.content as MultimodalContent[]).every(
                          (c) => c.type === "text",
                        )
                      }
                      onDoubleClickCapture={() => {
                        // 移除移动端双击设置输入框的功能，因为输入逻辑已迁移到 ChatInputPanel
                        // if (!isMobileScreen) return;
                        // setUserInput(content.text || "");
                      }}
                      parentRef={scrollRef}
                      defaultShow={index >= 6}
                    />
                  )}
                  {content.type === "image_url" && content.image_url?.url && (
                    <img
                      className={styles["chat-message-item-image"]}
                      src={content.image_url.url}
                      alt=""
                    />
                  )}
                </Fragment>
              ))
            ) : (
              <>
                <Markdown
                  key={message.streaming ? "loading" : "done"}
                  content={getMessageTextContent(message)}
                  loading={
                    (message.preview || message.streaming) &&
                    message.content.length === 0 &&
                    !isUser
                  }
                  onDoubleClickCapture={() => {
                    // 移除移动端双击设置输入框的功能，因为输入逻辑已迁移到 ChatInputPanel
                    // if (!isMobileScreen) return;
                    // setUserInput(getMessageTextContent(message));
                  }}
                  parentRef={scrollRef}
                  defaultShow={index >= 6}
                />
                {getMessageImages(message).length == 1 && (
                  <img
                    className={styles["chat-message-item-image"]}
                    src={getMessageImages(message)[0]}
                    alt=""
                  />
                )}
                {getMessageImages(message).length > 1 && (
                  <div
                    className={styles["chat-message-item-images"]}
                    style={
                      {
                        "--image-count": getMessageImages(message).length,
                      } as React.CSSProperties
                    }
                  >
                    {getMessageImages(message).map((image, imageIndex) => (
                      <img
                        className={styles["chat-message-item-image-multi"]}
                        key={imageIndex}
                        src={image}
                        alt=""
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 将底部操作按钮组移到这里，只在非用户消息时显示 */}
          {!isUser &&
            effectiveShowActions &&
            messageHeights[message.id ?? ""] > window.innerHeight * 0.65 && (
              <div className={styles["chat-message-bottom-actions"]}>
                <MessageActions
                  message={message}
                  onResend={onResend}
                  onDelete={onDelete}
                  onUserStop={onUserStop}
                  onBranch={onBranch}
                  onBatchApply={onBatchApply}
                  onBatchDelete={onBatchDelete}
                  index={index}
                  showBranch={showBranch}
                  showBatchApply={!!session?.groupId} // 组内会话下所有消息都显示批量应用按钮
                  showBatchDelete={!!session?.groupId} // 组内会话下所有消息都显示批量删除按钮
                  showDelete={!session?.groupId} // 组内会话隐藏单个删除按钮
                  showMergeCopy={
                    !!session?.groupId && message.role === "assistant"
                  }
                  onMergeCopy={(msg, format) =>
                    session
                      ? handleMergeCopy(msg, session, chatStore, format)
                      : undefined
                  }
                />
              </div>
            )}

          <div className={styles["chat-message-footer"]}>
            <div className={styles["chat-message-date"]}>
              {message.date
                ? typeof message.date === "string"
                  ? new Date(message.date).toLocaleString()
                  : (message.date as Date).toLocaleString()
                : ""}
            </div>
            {!readOnly && <MessageMetrics message={message} />}
          </div>
        </div>
      </div>
    </Fragment>
  );
}
