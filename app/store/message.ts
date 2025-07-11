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

// 使用 localforage 存储聊天消息
class MessageStorage {
  private storage: LocalForage | null = null;

  private getStorage(): LocalForage | null {
    if (!isClient) return null;
    if (!this.storage) {
      this.storage = localforage.createInstance({
        name: "JChat",
        storeName: "messages",
      });
    }
    return this.storage;
  }

  /**
   * 获取指定会话的消息数组
   * @param sessionId 会话 ID
   * @returns 消息数组，如果不存在则返回空数组
   */
  async get(sessionId: string): Promise<ChatMessage[]> {
    try {
      const storage = this.getStorage();
      if (!storage) return [];
      const messages = await storage.getItem<ChatMessage[]>(sessionId);
      return messages || [];
    } catch (error) {
      console.error(`[MessageStorage] 获取消息失败: ${sessionId}`, error);
      return [];
    }
  }

  /**
   * 保存消息数组到指定会话
   * @param sessionId 会话 ID
   * @param messages 消息数组
   */
  async save(sessionId: string, messages: ChatMessage[]): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      await storage.setItem(sessionId, messages);
      return true;
    } catch (error) {
      console.error(`[MessageStorage] 保存消息失败: ${sessionId}`, error);
      return false;
    }
  }

  /**
   * 删除指定会话的消息
   * @param sessionId 会话 ID
   */
  async delete(sessionId: string): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false;
      await storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error(`[MessageStorage] 删除消息失败: ${sessionId}`, error);
      return false;
    }
  }
}

// 创建全局实例
export const messageStorage = new MessageStorage();
