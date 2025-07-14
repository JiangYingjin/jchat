import clsx from "clsx";
import { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../store";
import Locale from "../locales";
import { Markdown } from "./markdown";
import styles from "../styles/thinking-content.module.scss";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";

export function ThinkingContent({
  message,
  onDoubleClick,
}: {
  message: ChatMessage;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const thinkingContentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
      requestAnimationFrame((session) => {});
    }
  }, [thinkingContent, isThinking, expanded]);

  // 修改焦点离开事件处理
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.relatedTarget as Node)
      ) {
        setExpanded(false);
      }
    };

    const handleClickInside = (e: MouseEvent) => {
      // 无论是否在思考状态，点击思考框时都应该展开
      if (!expanded) {
        setExpanded(true);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    containerRef.current?.addEventListener("focusout", handleFocusOut);
    containerRef.current?.addEventListener("click", handleClickInside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      containerRef.current?.removeEventListener("focusout", handleFocusOut);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      containerRef.current?.removeEventListener("click", handleClickInside);
    };
  }, [expanded]); // 只需要 expanded 作为依赖

  if (!thinkingContent) return null;

  return (
    <div
      ref={containerRef}
      className={clsx(
        styles["thinking-container"],
        expanded && styles["expanded"],
      )}
      tabIndex={0}
    >
      <div className={styles["thinking-header"]}>
        <div className={styles["thinking-title"]}>
          {Locale.Chat.Thinking.Title}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <div
            className={styles["thinking-toggle"]}
            onClick={(e) => {
              e.stopPropagation(); // 阻止事件冒泡
              setExpanded(!expanded);
            }}
          >
            {expanded ? <MinIcon /> : <MaxIcon />}
          </div>
        </div>
      </div>
      <div
        className={styles["thinking-content-wrapper"]}
        onClick={(e) => {
          // 无论是否在思考状态，点击时都应该展开
          if (!expanded) {
            setExpanded(true);
          }
        }}
      >
        {!expanded && <div className={styles["thinking-content-top"]}></div>}
        <div
          className={clsx(
            styles["thinking-content"],
            expanded && styles["expanded"],
          )}
          ref={thinkingContentRef}
          onClick={(e) => {
            // 在展开状态下，直接传递点击事件给父组件
            if (expanded && onDoubleClick) {
              e.stopPropagation(); // 阻止事件冒泡
              onDoubleClick(e);
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
