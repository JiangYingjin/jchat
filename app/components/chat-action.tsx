import React, { useRef, useState, useLayoutEffect } from "react";
import clsx from "clsx";
import styles from "../styles/chat.module.scss";
import LoadingIcon from "../icons/three-dots.svg";

export function ChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean; // 新增参数，控制是否总是 full 宽度
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useLayoutEffect(() => {
    if (props.alwaysFullWidth && iconRef.current && textRef.current) {
      // 只在依赖变化时测量一次
      const getWidth = (dom: HTMLDivElement) =>
        dom.getBoundingClientRect().width;
      const textWidth = getWidth(textRef.current);
      const iconWidth = getWidth(iconRef.current);
      setWidth({
        full: textWidth + iconWidth,
        icon: iconWidth,
      });
    }
    // 依赖项不要加 width
  }, [props.text, props.icon, props.alwaysFullWidth]);

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={() => {
        if (props.loding) return;
        props.onClick();
        iconRef ? setTimeout(updateWidth, 1) : undefined;
      }}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && props.text}
      </div>
      {props.innerNode}
    </div>
  );
}

// 新增：双击确认的 ChatAction 组件
export function DoubleClickChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });
  const [clickCount, setClickCount] = useState(0);
  const [isConfirmed, setIsConfirmed] = useState(false);

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
          // 当确认时改变样式
          ...(isConfirmed
            ? {
                backgroundColor: "var(--primary-light, #e6f0fa)",
                color: "var(--primary, #2196f3)",
                border: "1.5px solid var(--primary)",
              }
            : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useLayoutEffect(() => {
    if (props.alwaysFullWidth && iconRef.current && textRef.current) {
      // 只在依赖变化时测量一次
      const getWidth = (dom: HTMLDivElement) =>
        dom.getBoundingClientRect().width;
      const textWidth = getWidth(textRef.current);
      const iconWidth = getWidth(iconRef.current);
      setWidth({
        full: textWidth + iconWidth,
        icon: iconWidth,
      });
    }
    // 依赖项不要加 width
  }, [props.text, props.icon, props.alwaysFullWidth]);

  const handleClick = () => {
    if (props.loding) return;

    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);

    if (newClickCount === 1) {
      // 第一次点击，显示确认状态
      setIsConfirmed(true);
      // 3秒后自动重置
      setTimeout(() => {
        setClickCount(0);
        setIsConfirmed(false);
      }, 3000);
    } else if (newClickCount === 2) {
      // 第二次点击，执行操作
      props.onClick();
      setClickCount(0);
      setIsConfirmed(false);
    }
  };

  const handleMouseLeave = () => {
    // 鼠标移出时重置状态
    setClickCount(0);
    setIsConfirmed(false);
  };

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={handleClick}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onMouseLeave={handleMouseLeave}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && props.text}
      </div>
      {props.innerNode}
    </div>
  );
}
