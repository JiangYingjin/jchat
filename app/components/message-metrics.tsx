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

  const parts: string[] = [];

  // Cost 显示
  if (message.cost) {
    const cost =
      message.cost < 1 ? message.cost.toFixed(2) : message.cost.toFixed(1);
    parts.push(`￥${cost}`);
  }

  // Token 显示 (PT/CT)
  if (message.prompt_tokens && message.completion_tokens) {
    parts.push(`${message.prompt_tokens}/${message.completion_tokens}`);
  } else if (message.prompt_tokens) {
    parts.push(`${message.prompt_tokens}/-`);
  } else if (message.completion_tokens) {
    parts.push(`-/${message.completion_tokens}`);
  }

  // 时间显示 (TTFT/Total) 和 TPS
  if (message.ttft && message.total_time) {
    const ttft =
      message.ttft < 10
        ? message.ttft.toFixed(1)
        : Math.round(message.ttft).toString();
    const total =
      message.total_time < 10
        ? message.total_time.toFixed(1)
        : Math.round(message.total_time).toString();
    const timePart = `${ttft}s/${total}s`;

    // 如果有 TPS，直接附加到时间后面
    if (message.tps) {
      parts.push(`${timePart} (${message.tps})`);
    } else {
      parts.push(timePart);
    }
  } else if (message.ttft) {
    const ttft =
      message.ttft < 10
        ? message.ttft.toFixed(1)
        : Math.round(message.ttft).toString();
    parts.push(`${ttft}s/-`);
  } else if (message.total_time) {
    const total =
      message.total_time < 10
        ? message.total_time.toFixed(1)
        : Math.round(message.total_time).toString();
    parts.push(`-/${total}s`);
  } else if (message.tps) {
    // 只有 TPS 没有时间信息的情况
    parts.push(`(${message.tps})`);
  }

  // 如果没有任何指标，不显示
  if (parts.length === 0) {
    return null;
  }

  return (
    <div className={styles["message-metrics"]}>
      {parts.map((part, index) => (
        <span key={index} className={styles["metric-item"]}>
          <span className={styles["metric-value"]}>{part}</span>
          {index < parts.length - 1 && (
            <span className={styles["metric-separator"]}>·</span>
          )}
        </span>
      ))}
    </div>
  );
}
