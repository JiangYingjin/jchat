import localforage from "localforage";
import { isClient } from "../utils";

export interface SystemMessageData {
  text: string;
  images: string[];
  scrollTop: number;
  selection: { start: number; end: number };
  updateAt: number;
}

// 使用 localforage 存储系统消息
class SystemMessageStorage {
  private storage: LocalForage | null = null;

  private getStorage(): LocalForage | null {
    if (!isClient) return null;

    if (!this.storage) {
      this.storage = localforage.createInstance({
        name: "JChat",
        storeName: "systemMessages",
      });
    }
    return this.storage;
  }

  async save(sessionId: string, data: SystemMessageData): Promise<boolean> {
    // 数据未恢复时，禁止系统消息持久化
    if (
      typeof window !== "undefined" &&
      (window as any).__jchat_data_restored !== true
    ) {
      console.log(`[SystemMessageStorage] ❌ 数据未恢复，禁止系统消息持久化`, {
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
      console.error("保存系统消息失败:", error);
      return false;
    }
  }

  async get(sessionId: string): Promise<SystemMessageData> {
    try {
      const storage = this.getStorage();
      if (!storage)
        return {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        };
      const data = await storage.getItem<SystemMessageData>(sessionId);
      if (!data) {
        return {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        };
      }
      return data;
    } catch (error) {
      console.error("获取系统消息失败:", error);
      return {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false; // 服务器端直接返回false
      await storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error("删除系统消息失败:", error);
      return false;
    }
  }

  // 验证系统消息是否存在且有效
  async validate(sessionId: string): Promise<boolean> {
    try {
      const data = await this.get(sessionId);
      return (
        data !== null && (data.text.trim() !== "" || data.images.length > 0)
      );
    } catch (error) {
      console.error(`验证系统消息失败 (${sessionId}):`, error);
      return false;
    }
  }
}

// 创建全局实例
export const systemMessageStorage = new SystemMessageStorage();
