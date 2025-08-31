import React, { useMemo, useEffect, useState, useRef } from "react";
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
 * 显示字符数、行数、词数、词元数
 */
export const StatsBar: React.FC<StatsBarProps> = ({
  stats,
  className,
  images = [],
  text = "",
}) => {
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const isFirstLoad = useRef(true);

  // 计算词元数
  useEffect(() => {
    const calculateTokens = async () => {
      // 当字符数为 0 且图像列表为空时，直接返回 0，不进行词元统计
      // 当图像列表不为空时，即使文本为空也要进行词元统计
      if (!stats.characters && images.length === 0) {
        setTokenCount(0);
        return;
      }

      try {
        const count = await countTokensWithCache(text, images);
        setTokenCount(count);
      } catch (error) {
        console.error("Failed to calculate tokens:", error);
        setTokenCount(null);
      }
    };

    // 如果是首次加载，立即执行计算
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      calculateTokens();
    } else {
      // 后续更新使用防抖，避免频繁计算
      const timeoutId = setTimeout(calculateTokens, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [stats.characters, images, text]);

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
          词元: {tokenCount !== null ? tokenCount.toLocaleString() : "0"}
        </div>
      </div>
    </div>
  );
};
