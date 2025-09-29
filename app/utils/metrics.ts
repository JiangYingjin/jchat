// 统一的指标格式化工具

/**
 * 格式化时间，<10 保留 1 位小数，否则取整
 */
export function formatTime(time: number): string {
  return time < 10 ? time.toFixed(1) : Math.round(time).toString();
}

/**
 * 格式化成本，<1 保留 2 位小数，否则保留 1 位小数
 */
export function formatCost(cost: number): string {
  return cost < 1 ? cost.toFixed(2) : cost.toFixed(1);
}

/**
 * 格式化 TPS，取整显示
 */
export function formatTps(tps: number): string {
  return Math.round(tps).toString();
}
