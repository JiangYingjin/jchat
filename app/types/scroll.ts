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

/** 用户主动保存的会话阅读锚点，与自动恢复滚动状态分开持久化 */
export interface SessionScrollBookmark {
  id: string;
  sessionId: string;
  messageId: string;
  /** 消息 ID 失效时用于定位邻近消息的回退索引 */
  messageIndex: number;
  /** 锚点顶部相对滚动视口顶部的偏移量 */
  viewportOffset: number;
  /** 书签在消息内部的归一化位置，用于轨道区分同一长消息中的多个位置 */
  messageProgress: number;
  createdAt: number;
}

/**
 * 滚动状态存储接口
 */
export interface ScrollStateStorage {
  save(sessionId: string, scrollState: SessionScrollState): Promise<boolean>;
  get(sessionId: string): Promise<SessionScrollState | null>;
}
