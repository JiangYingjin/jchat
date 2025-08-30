import React from "react";
import monacoStyles from "../../styles/monaco-editor.module.scss";

interface ErrorDisplayProps {
  error: string | null;
  onReload?: () => void;
  className?: string;
}

/**
 * Monaco 编辑器错误显示组件
 * 显示加载错误信息和重试按钮
 */
export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onReload,
  className,
}) => {
  if (!error) return null;

  return (
    <div className={`${monacoStyles["monaco-error"]} ${className || ""}`}>
      <div className={monacoStyles["error-icon"]}>⚠️</div>
      <div className={monacoStyles["error-message"]}>{error}</div>
      <div className={monacoStyles["error-suggestion"]}>
        <button onClick={onReload || (() => window.location.reload())}>
          重新加载
        </button>
      </div>
    </div>
  );
};
