import localforage from "localforage";

// 检查是否在客户端环境
const isClient = typeof window !== "undefined";

// 聊天输入数据存储接口
interface ChatInputData {
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

  async saveChatInput(
    sessionId: string,
    data: ChatInputData,
  ): Promise<boolean> {
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

  async getChatInput(sessionId: string): Promise<ChatInputData | null> {
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

  async deleteChatInput(sessionId: string): Promise<boolean> {
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
export const chatInputStorage = new ChatInputStorage();

// 导出类型供其他地方使用
export type { ChatInputData };
