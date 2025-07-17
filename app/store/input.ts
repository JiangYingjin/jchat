import localforage from "localforage";
import { isClient } from "../utils";

// 聊天输入数据存储接口
export interface ChatInputData {
  text: string;
  images: string[];
  scrollTop: number;
  selection: { start: number; end: number };
  updateAt: number;
}

// 使用 localforage 存储聊天输入数据
class ChatInputStorage {
  private storage: LocalForage | null = null;

  private getStorage(): LocalForage | null {
    if (!isClient) return null;

    if (!this.storage) {
      this.storage = localforage.createInstance({
        name: "JChat",
        storeName: "chatInput",
        description: "Chat input storage",
      });
    }
    return this.storage;
  }

  async save(sessionId: string, data: ChatInputData): Promise<boolean> {
    // 数据未恢复时，禁止输入数据持久化
    if (
      typeof window !== "undefined" &&
      (window as any).__jchat_data_restored !== true
    ) {
      console.log(`[ChatInputStorage] ❌ 数据未恢复，禁止输入数据持久化`, {
        sessionId,
        isDataRestored: (window as any).__jchat_data_restored,
        timestamp: Date.now(),
      });
      return false;
    }

    try {
      const storage = this.getStorage();
      if (!storage) return false; // 服务器端直接返回false
      await storage.setItem(sessionId, data);
      return true;
    } catch (error) {
      console.error("保存聊天输入失败:", error);
      return false;
    }
  }

  async get(sessionId: string): Promise<ChatInputData | null> {
    try {
      const storage = this.getStorage();
      if (!storage) return null; // 服务器端直接返回null
      const data = await storage.getItem<ChatInputData>(sessionId);
      return data || null;
    } catch (error) {
      console.error("获取聊天输入失败:", error);
      return null;
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false; // 服务器端直接返回false
      await storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error("删除聊天输入失败:", error);
      return false;
    }
  }

  // 保存图片数据
  async saveImages(sessionId: string, images: string[]): Promise<boolean> {
    try {
      const currentData = (await this.get(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };

      return await this.save(sessionId, {
        ...currentData,
        images,
        updateAt: Date.now(),
      });
    } catch (error) {
      console.error("[ChatInput][Save] 保存图片失败:", error);
      return false;
    }
  }
}

// 创建全局实例
export const chatInputStorage = new ChatInputStorage();
