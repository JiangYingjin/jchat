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
      if (!storage) {
        console.log(`[ChatInputStorage] ❌ 存储未初始化`);
        return false; // 服务器端直接返回false
      }

      await storage.setItem(sessionId, data);
      // console.log(`[ChatInputStorage] ✅ 保存成功`, {
      //   sessionId: sessionId.substring(0, 8) + "...",
      //   savedText:
      //     data.text.substring(0, 50) + (data.text.length > 50 ? "..." : ""),
      //   savedTextLength: data.text.length,
      //   timestamp: Date.now(),
      // });
      return true;
    } catch (error) {
      console.error(`[ChatInputStorage] ❌ 保存聊天输入失败:`, error);
      return false;
    }
  }

  async get(sessionId: string): Promise<ChatInputData | null> {
    try {
      const storage = this.getStorage();
      if (!storage) {
        console.log(`[ChatInputStorage] ❌ 存储未初始化，返回null`);
        return null; // 服务器端直接返回null
      }

      const data = await storage.getItem<ChatInputData>(sessionId);

      return data || null;
    } catch (error) {
      console.error(`[ChatInputStorage] ❌ 获取聊天输入失败:`, error);
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

  // 保存图片数据 - 注意：这个方法可能被外部组件调用，无法访问组件当前状态
  async saveImages(sessionId: string, images: string[]): Promise<boolean> {
    // console.log(`[ChatInputStorage] 🖼️ 保存图片数据`, {
    //   sessionId: sessionId.substring(0, 8) + "...",
    //   imageCount: images.length,
    //   timestamp: Date.now(),
    // });

    try {
      const currentData = (await this.get(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };

      const result = await this.save(sessionId, {
        ...currentData,
        images,
        updateAt: Date.now(),
      });

      // console.log(`[ChatInputStorage] 🖼️ 保存图片${result ? "成功" : "失败"}`, {
      //   sessionId: sessionId.substring(0, 8) + "...",
      //   imageCount: images.length,
      //   preservedText:
      //     currentData.text.substring(0, 30) +
      //     (currentData.text.length > 30 ? "..." : ""),
      //   timestamp: Date.now(),
      // });

      return result;
    } catch (error) {
      console.error("[ChatInput][Save] 保存图片失败:", error);
      return false;
    }
  }
}

// 创建全局实例
export const chatInputStorage = new ChatInputStorage();
