import React, { Fragment, RefObject } from "react";
import { ChatMessage } from "../store";
import { getMessageTextContent, getMessageImages } from "../utils";
import { MultimodalContent } from "../client/api";
import { Markdown } from "./markdown";
import { ThinkingContent } from "./thinking-content";
import { MessageActions } from "./message-actions";
import styles from "./chat.module.scss";

type RenderMessage = ChatMessage & { preview?: boolean };

interface ChatMessageItemProps {
  message: RenderMessage;
  index: number;
  isUser: boolean;
  showActions: boolean;
  messageRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>;
  scrollRef: RefObject<HTMLDivElement>;
  messageHeights: { [key: string]: number };
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  onEditMessage: (
    message: ChatMessage,
    type?: "content" | "reasoningContent",
    select?: { anchorText: string; extendText: string },
  ) => void;
  handleTripleClick: (
    e: React.MouseEvent,
    callback: (select: { anchorText: string; extendText: string }) => void,
  ) => void;
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
  onEditMessage,
  handleTripleClick,
}: ChatMessageItemProps) {
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
              <div className={styles["chat-model-name"]}>{message.model}</div>
            )}

            {showActions && (
              <div className={styles["chat-message-actions"]}>
                <MessageActions
                  message={message}
                  onResend={onResend}
                  onDelete={onDelete}
                  onUserStop={onUserStop}
                  onBranch={onBranch}
                  index={index}
                />
              </div>
            )}
          </div>

          {!isUser && message.reasoningContent && (
            <ThinkingContent
              message={message}
              onDoubleClick={(e) =>
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
            onDoubleClick={async (e) => {
              if (message.streaming) return;
              // 用户消息保持双击编辑
              if (isUser) {
                onEditMessage(message, "content");
              }
            }}
            onClick={(e) => {
              // 非用户消息使用三击编辑
              if (!isUser) {
                handleTripleClick(e, (select) => {
                  onEditMessage(message, "content", select);
                });
              }
            }}
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
            messageHeights[message.id ?? ""] > window.innerHeight * 0.1 && (
              <div className={styles["chat-message-bottom-actions"]}>
                <MessageActions
                  message={message}
                  onResend={onResend}
                  onDelete={onDelete}
                  onUserStop={onUserStop}
                  onBranch={onBranch}
                  index={index}
                />
              </div>
            )}

          <div className={styles["chat-message-action-date"]}>
            {message.date.toLocaleString()}
          </div>
        </div>
      </div>
    </Fragment>
  );
}
