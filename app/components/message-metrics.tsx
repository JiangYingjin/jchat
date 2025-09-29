import React, { useState, useEffect } from "react";
import { ChatMessage, useChatStore } from "../store";
import styles from "../styles/chat.module.scss";
import { showToast } from "./ui-lib";
import { formatTime, formatCost, formatTps } from "../utils/metrics";

interface MessageMetricsProps {
  message: ChatMessage;
}

// 构建指标显示内容
const buildMetrics = (message: ChatMessage, isExpanded: boolean) => {
  const parts: string[] = [];

  // 成本显示
  if (message.cost) {
    parts.push(`￥${formatCost(message.cost)}`);
  }

  // Token 显示
  if (message.prompt_tokens || message.completion_tokens) {
    const prompt = message.prompt_tokens || "-";
    const completion = message.completion_tokens || "-";
    parts.push(`${prompt}/${completion}`);
  }

  // 时间显示
  if (message.ttft || message.total_time || message.tps) {
    let timePart = "";

    if (message.ttft && message.total_time) {
      timePart = `${formatTime(message.ttft)}s/${formatTime(message.total_time)}s`;
    } else if (message.ttft) {
      timePart = `${formatTime(message.ttft)}s/-`;
    } else if (message.total_time) {
      timePart = `-/${formatTime(message.total_time)}s`;
    }

    if (message.tps) {
      const tpsStr = formatTps(message.tps);
      timePart = timePart ? `${timePart} (${tpsStr})` : `(${tpsStr})`;
    }

    if (timePart) {
      parts.push(timePart);
    }
  }

  // 根据展开状态返回显示内容
  return isExpanded ? parts : parts.slice(0, 1);
};

export function MessageMetrics({ message }: MessageMetricsProps) {
  const chatStore = useChatStore();
  const [isExpanded, setIsExpanded] = useState(false);

  // 监听全局 expandMetrics 设置
  useEffect(() => {
    setIsExpanded(chatStore.expandMetrics);
  }, [chatStore.expandMetrics]);

  // 只显示模型消息的指标
  if (message.role !== "assistant") {
    return null;
  }

  const metrics = buildMetrics(message, isExpanded);

  // 如果没有任何指标，不显示
  if (metrics.length === 0) {
    return null;
  }

  const handleMetricsToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isExpanded) {
      showToast("全局折叠消息指标");
    } else {
      showToast("全局展开消息指标");
    }
    setIsExpanded(!isExpanded);
    chatStore.setExpandMetrics(!chatStore.expandMetrics);
  };

  return (
    <div
      className={styles["message-metrics"]}
      onClick={handleMetricsToggle}
      onDoubleClick={handleMetricsToggle}
    >
      {metrics.map((part, index) => (
        <span key={index} className={styles["metric-item"]}>
          <span className={styles["metric-value"]}>{part}</span>
          {index < metrics.length - 1 && (
            <span className={styles["metric-separator"]}>·</span>
          )}
        </span>
      ))}
    </div>
  );
}
