import * as React from "react";

import styles from "../styles/button.module.scss";
import { CSSProperties } from "react";

export type ButtonType = "primary" | "secondary" | "danger" | null;

import LoadingIcon from "../icons/three-dots-white.svg";
import DeleteIcon from "../icons/clear.svg";

export function IconButton(props: {
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  icon?: JSX.Element;
  type?: ButtonType;
  text?: string;
  bordered?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  tabIndex?: number;
  autoFocus?: boolean;
  loding?: boolean;
  style?: CSSProperties;
  aria?: string;
}) {
  const handleClick = () => {
    if (props.disabled) return;
    if (props.onClick) {
      props.onClick();
    }
  };

  return (
    <button
      className={
        styles["icon-button"] +
        ` ${props.bordered && styles.border} ${props.className ?? ""} shadow clickable ${styles[props.type ?? ""]}`
      }
      onClick={handleClick}
      onContextMenu={props.onContextMenu}
      title={props.title}
      disabled={props.disabled}
      role="button"
      tabIndex={props.tabIndex}
      autoFocus={props.autoFocus}
      style={props.style}
      aria-label={props.aria}
    >
      {props.icon && !props.loding && (
        <div
          aria-label={props.text || props.title}
          className={
            styles["icon-button-icon"] +
            ` ${props.type === "primary" && "no-dark"}`
          }
        >
          {props.icon}
        </div>
      )}
      {props.text && !props.loding && (
        <div
          aria-label={props.text || props.title}
          className={styles["icon-button-text"]}
        >
          {props.text}
        </div>
      )}
      {props.loding ? (
        <div
          className={
            styles["icon-button-loading-icon"] +
            ` ${props.type === "primary" && "no-dark"}`
          }
        >
          <LoadingIcon />
        </div>
      ) : null}
    </button>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div
      className={styles["delete-image"]}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.deleteImage();
      }}
    >
      <DeleteIcon />
    </div>
  );
}
