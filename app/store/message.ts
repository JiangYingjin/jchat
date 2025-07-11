import localforage from "localforage";
import type { RequestMessage } from "../client/api";
import { isClient } from "../utils";

export type ChatMessage = RequestMessage & {
  id: string;
  model?: string;
  date: string;
  streaming?: boolean;
  isError?: boolean;
};

// 创建一个专用于存储消息的 localforage 实例
// 这会在 'JChat' 数据库中创建一个名为 'messages' 的新对象存储（表）
let messageStore: LocalForage | null = null;

// 延迟初始化存储，只在客户端环境中创建
const getMessageStore = (): LocalForage => {
  if (!isClient) {
    throw new Error("Message storage is only available in client environment");
  }

  if (!messageStore) {
    messageStore = localforage.createInstance({
      name: "JChat",
      storeName: "messages",
    });
  }

  return messageStore;
};

export const messageStorage = {
  /**
   * 从 IndexedDB 中获取指定会话的消息
   * @param sessionId 会话 ID
   * @returns 消息数组，如果不存在则返回空数组
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      if (!isClient) return [];
      const store = getMessageStore();
      const messages = await store.getItem<ChatMessage[]>(sessionId);
      return messages || [];
    } catch (error) {
      console.error(
        `[MessageStorage] Failed to get messages for session ${sessionId}`,
        error,
      );
      return [];
    }
  },

  /**
   * 将消息数组保存到 IndexedDB
   * @param sessionId 会话 ID
   * @param messages 要保存的消息数组
   */
  async saveMessages(
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    try {
      if (!isClient) return; // 服务器端直接返回
      const store = getMessageStore();
      await store.setItem(sessionId, messages);
    } catch (error) {
      console.error(
        `[MessageStorage] Failed to save messages for session ${sessionId}`,
        error,
      );
      throw error; // 重新抛出错误，让调用者处理
    }
  },

  /**
   * 向指定会话追加新消息并保存
   * @param sessionId 会话 ID
   * @param newMessages 要追加的新消息
   */
  async appendMessages(
    sessionId: string,
    newMessages: ChatMessage[],
  ): Promise<ChatMessage[]> {
    try {
      const existingMessages = await this.getMessages(sessionId);
      const updatedMessages = [...existingMessages, ...newMessages];
      await this.saveMessages(sessionId, updatedMessages);
      return updatedMessages;
    } catch (error) {
      console.error(
        `[MessageStorage] Failed to append messages for session ${sessionId}`,
        error,
      );
      throw error;
    }
  },

  /**
   * 更新指定位置的消息
   * @param sessionId 会话 ID
   * @param messageIndex 消息索引
   * @param updater 更新函数
   */
  async updateMessage(
    sessionId: string,
    messageIndex: number,
    updater: (message: ChatMessage) => void,
  ): Promise<ChatMessage[]> {
    try {
      const messages = await this.getMessages(sessionId);
      if (messageIndex >= 0 && messageIndex < messages.length) {
        updater(messages[messageIndex]);
        await this.saveMessages(sessionId, messages);
      }
      return messages;
    } catch (error) {
      console.error(
        `[MessageStorage] Failed to update message for session ${sessionId}`,
        error,
      );
      throw error;
    }
  },

  /**
   * 从 IndexedDB 中删除指定会话的消息
   * @param sessionId 会话 ID
   */
  async deleteMessages(sessionId: string): Promise<void> {
    try {
      if (!isClient) return; // 服务器端直接返回
      const store = getMessageStore();
      await store.removeItem(sessionId);
      console.log(`[MessageStorage] Deleted messages for session ${sessionId}`);
    } catch (error) {
      console.error(
        `[MessageStorage] Failed to delete messages for session ${sessionId}`,
        error,
      );
      throw error;
    }
  },

  /**
   * 批量删除多个会话的消息
   * @param sessionIds 会话 ID 数组
   */
  async deleteMultipleMessages(sessionIds: string[]): Promise<void> {
    try {
      await Promise.all(sessionIds.map((id) => this.deleteMessages(id)));
    } catch (error) {
      console.error(
        "[MessageStorage] Failed to delete multiple messages",
        error,
      );
      throw error;
    }
  },

  /**
   * 获取消息存储的统计信息（用于调试）
   */
  async getStorageStats(): Promise<{ keys: string[]; totalSessions: number }> {
    try {
      if (!isClient) return { keys: [], totalSessions: 0 };
      const store = getMessageStore();
      const keys = await store.keys();
      return {
        keys: keys as string[],
        totalSessions: keys.length,
      };
    } catch (error) {
      console.error("[MessageStorage] Failed to get storage stats", error);
      return { keys: [], totalSessions: 0 };
    }
  },
};
