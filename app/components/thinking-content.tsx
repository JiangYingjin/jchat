import clsx from "clsx";
import { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../store";
import Locale from "../locales";
import { Markdown } from "./markdown";

import styles from "./thinking-content.module.scss";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import CopyIcon from "../icons/copy.svg";
import { copyToClipboard } from "../utils";

export function ThinkingContent({
  message,
  onDoubleClick,
}: {
  message: ChatMessage;
  onDoubleClick?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const thinkingContentRef = useRef<HTMLDivElement>(null);
  const hasAutoExpandedRef = useRef(false);

  const thinkingContent = message.reasoningContent;
  const isThinking =
    message.streaming && thinkingContent && thinkingContent.length > 0;

  useEffect(() => {
    if (isThinking && !hasAutoExpandedRef.current) {
      setExpanded(true);
      hasAutoExpandedRef.current = true;
    }
    if (!isThinking) {
      hasAutoExpandedRef.current = false;
    }
  }, [isThinking]);

  useEffect(() => {
    if (isThinking && thinkingContentRef.current) {
      requestAnimationFrame(() => {
        // if (thinkingContentRef.current) {
        //   thinkingContentRef.current.scrollTop =
        //     thinkingContentRef.current.scrollHeight;
        // }
      });
    }
  }, [thinkingContent, isThinking, expanded]);

  if (!thinkingContent) return null;

  return (
    <div
      className={clsx(
        styles["thinking-container"],
        expanded && styles["expanded"],
      )}
    >
      <div className={styles["thinking-header"]}>
        <div className={styles["thinking-title"]}>
          {Locale.Chat.Thinking.Title}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {/* <div
            className={styles["thinking-toggle"]}
            title={Locale.Copy.Success}
            onClick={() => copyToClipboard(thinkingContent)}
          >
            <CopyIcon />
          </div> */}
          <div
            className={styles["thinking-toggle"]}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <MinIcon /> : <MaxIcon />}
          </div>
        </div>
      </div>
      <div className={styles["thinking-content-wrapper"]}>
        {!expanded && <div className={styles["thinking-content-top"]}></div>}
        <div
          className={clsx(
            styles["thinking-content"],
            expanded && styles["expanded"],
          )}
          ref={thinkingContentRef}
          onDoubleClick={() => {
            if (onDoubleClick) {
              onDoubleClick();
            }
          }}
        >
          <div className={styles["thinking-content-text"]}>
            <Markdown content={thinkingContent} />
          </div>
        </div>
        {!expanded && <div className={styles["thinking-content-bottom"]}></div>}
      </div>
    </div>
  );
}
