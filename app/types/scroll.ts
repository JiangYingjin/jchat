/**
 * 滚动状态相关类型定义
 */

/**
 * 会话滚动状态接口
 */
export interface SessionScrollState {
  sessionId: string;
  scrollTop: number;
  messageIndex: number;
  viewportHeight: number;
  timestamp: number;
}

/**
 * 滚动状态存储接口
 */
export interface ScrollStateStorage {
  save(sessionId: string, scrollState: SessionScrollState): Promise<boolean>;
  get(sessionId: string): Promise<SessionScrollState | null>;
}
