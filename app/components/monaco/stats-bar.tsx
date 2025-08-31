import React, { useMemo, useEffect, useState } from "react";
import monacoStyles from "../../styles/monaco-editor.module.scss";
import { countTokensWithCache } from "../../utils/token-count";

interface StatsBarProps {
  stats: {
    characters: number;
    lines: number;
    words: number;
  };
  className?: string;
  images?: string[]; // 添加图片数组属性
  text?: string; // 添加文本内容属性
}

/**
 * Monaco 编辑器统计信息状态栏
 * 显示字符数、行数、词数、词元数和内存状态
 */
export const StatsBar: React.FC<StatsBarProps> = ({
  stats,
  className,
  images = [],
  text = "",
}) => {
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // 计算词元数
  useEffect(() => {
    const calculateTokens = async () => {
      if (!stats.characters || !text.trim()) {
        setTokenCount(0);
        return;
      }

      setIsCalculating(true);
      try {
        const count = await countTokensWithCache(text, images);
        setTokenCount(count);
      } catch (error) {
        console.error("Failed to calculate tokens:", error);
        setTokenCount(null);
      } finally {
        setIsCalculating(false);
      }
    };

    // 防抖计算词元数，避免频繁计算
    const timeoutId = setTimeout(calculateTokens, 1000);
    return () => clearTimeout(timeoutId);
  }, [stats.characters, images, text]);

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
        <div className={monacoStyles["stat-item"]}>
          词元:{" "}
          {isCalculating
            ? "⏳"
            : tokenCount !== null
              ? `~${tokenCount.toLocaleString()}`
              : "~"}
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
