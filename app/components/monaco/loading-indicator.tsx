import React from "react";
import monacoStyles from "../../styles/monaco-editor.module.scss";

interface LoadingIndicatorProps {
  isLoading: boolean;
  message?: string;
  className?: string;
}

/**
 * Monaco 编辑器加载指示器组件
 * 显示加载状态和进度信息
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  isLoading,
  message = "正在加载编辑器...",
  className,
}) => {
  if (!isLoading) return null;

  return (
    <div className={`${monacoStyles["monaco-loading"]} ${className || ""}`}>
      <div className={monacoStyles["loading-spinner"]} />
      <span>{message}</span>
    </div>
  );
};
