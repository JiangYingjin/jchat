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
        description: "System messages storage",
      });
    }
    return this.storage;
  }

  async saveSystemMessage(
    sessionId: string,
    data: SystemMessageData,
  ): Promise<boolean> {
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

  async getSystemMessage(sessionId: string): Promise<SystemMessageData | null> {
    try {
      const storage = this.getStorage();
      if (!storage) return null; // 服务器端直接返回null
      const data = await storage.getItem<SystemMessageData>(sessionId);
      return data || null;
    } catch (error) {
      console.error("获取系统消息失败:", error);
      return null;
    }
  }

  async deleteSystemMessage(sessionId: string): Promise<boolean> {
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
  async validateSystemMessage(sessionId: string): Promise<boolean> {
    try {
      const data = await this.getSystemMessage(sessionId);
      return (
        data !== null && (data.text.trim() !== "" || data.images.length > 0)
      );
    } catch (error) {
      console.error(`验证系统消息失败 (${sessionId}):`, error);
      return false;
    }
  }

  // 批量验证系统消息
  async validateAllSystemMessages(
    sessionIds: string[],
  ): Promise<{ valid: string[]; invalid: string[] }> {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const sessionId of sessionIds) {
      const isValid = await this.validateSystemMessage(sessionId);
      if (isValid) {
        valid.push(sessionId);
      } else {
        invalid.push(sessionId);
      }
    }

    return { valid, invalid };
  }

  // 获取所有会话ID
  async getAllSessionIds(): Promise<string[]> {
    try {
      const storage = this.getStorage();
      if (!storage) return []; // 服务器端直接返回空数组
      const keys = await storage.keys();
      return keys;
    } catch (error) {
      console.error("获取所有会话ID失败:", error);
      return [];
    }
  }
}

// 创建全局实例
export const systemMessageStorage = new SystemMessageStorage();

export async function saveSystemMessageContentToStorage(
  sessionId: string,
  content: string,
  images: string[] = [],
  scrollTop: number = 0,
  selection: { start: number; end: number } = { start: 0, end: 0 },
) {
  try {
    // 保存文本和图片数据
    const data: SystemMessageData = {
      text: content,
      images,
      scrollTop,
      selection,
      updateAt: Date.now(),
    };
    const success = await systemMessageStorage.saveSystemMessage(
      sessionId,
      data,
    );
    if (!success) {
      throw new Error("保存到 IndexedDB 失败");
    }
  } catch (error) {
    console.error("保存系统消息失败:", error);
    alert("系统提示词保存失败，请重试。");
  }
}

export async function loadSystemMessageContentFromStorage(
  sessionId: string,
): Promise<SystemMessageData> {
  try {
    const data = await systemMessageStorage.getSystemMessage(sessionId);
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
    console.error("读取系统消息失败:", error);
    return {
      text: "",
      images: [],
      scrollTop: 0,
      selection: { start: 0, end: 0 },
      updateAt: Date.now(),
    };
  }
}
