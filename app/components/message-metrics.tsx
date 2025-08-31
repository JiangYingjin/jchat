import React from "react";
import { ChatMessage } from "../store";
import styles from "../styles/chat.module.scss";

interface MessageMetricsProps {
  message: ChatMessage;
}

export function MessageMetrics({ message }: MessageMetricsProps) {
  // 只显示模型消息（assistant）的指标
  if (message.role !== "assistant") {
    return null;
  }

  const metrics: Array<{
    label: string;
    value: string | number | undefined;
    unit?: string;
  }> = [];

  // 添加有值的指标
  if (message.prompt_tokens) {
    metrics.push({ label: "PT", value: message.prompt_tokens });
  }

  if (message.completion_tokens) {
    metrics.push({ label: "CT", value: message.completion_tokens });
  }

  if (message.cost) {
    metrics.push({ label: "Cost", value: `$${message.cost.toFixed(2)}` });
  }

  if (message.ttft) {
    metrics.push({ label: "TTFT", value: `${message.ttft}s` });
  }

  if (message.total_time) {
    metrics.push({ label: "Total", value: `${message.total_time}s` });
  }

  if (message.tps) {
    metrics.push({ label: "TPS", value: message.tps });
  }

  // 如果没有任何指标，不显示
  if (metrics.length === 0) {
    return null;
  }

  return (
    <div className={styles["message-metrics"]}>
      {metrics.map((metric, index) => (
        <span key={metric.label} className={styles["metric-item"]}>
          <span className={styles["metric-label"]}>{metric.label}:</span>
          <span className={styles["metric-value"]}>{metric.value}</span>
          {index < metrics.length - 1 && (
            <span className={styles["metric-separator"]}>|</span>
          )}
        </span>
      ))}
    </div>
  );
}
