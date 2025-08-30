import React, { useMemo } from "react";
import monacoStyles from "../../styles/monaco-editor.module.scss";

interface StatsBarProps {
  stats: {
    characters: number;
    lines: number;
    words: number;
  };
  className?: string;
}

/**
 * Monaco 编辑器统计信息状态栏
 * 显示字符数、行数、词数和内存状态
 */
export const StatsBar: React.FC<StatsBarProps> = ({ stats, className }) => {
  // 获取内存状态提示
  const getMemoryLevel = useMemo(() => {
    const { characters } = stats;
    if (characters > 5000000) return "critical";
    if (characters > 1000000) return "warning";
    return "normal";
  }, [stats]);

  const memoryLevelConfig = {
    normal: { color: "var(--text-color)", message: "" },
    warning: { color: "var(--orange)", message: "⚠️ 大文本模式" },
    critical: { color: "var(--red)", message: "🚨 超大文本模式" },
  };

  return (
    <div className={`${monacoStyles["monaco-status-bar"]} ${className || ""}`}>
      <div className={monacoStyles["monaco-stats"]}>
        <div className={monacoStyles["stat-item"]}>
          字符: {stats.characters.toLocaleString()}
        </div>
        <div className={monacoStyles["stat-item"]}>
          行数: {stats.lines.toLocaleString()}
        </div>
        <div className={monacoStyles["stat-item"]}>
          词数: {stats.words.toLocaleString()}
        </div>
      </div>
      <div
        className={`${monacoStyles["monaco-memory-status"]} ${monacoStyles[getMemoryLevel]}`}
      >
        {memoryLevelConfig[getMemoryLevel].message}
      </div>
    </div>
  );
};
