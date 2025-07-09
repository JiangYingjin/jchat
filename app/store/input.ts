import localforage from "localforage";

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
  private storage: LocalForage;

  constructor() {
    this.storage = localforage.createInstance({
      name: "JChat",
      storeName: "chatInput",
      description: "Chat input storage",
    });
  }

  async saveChatInput(
    sessionId: string,
    data: ChatInputData,
  ): Promise<boolean> {
    try {
      await this.storage.setItem(sessionId, data);
      return true;
    } catch (error) {
      console.error("保存聊天输入失败:", error);
      return false;
    }
  }

  async getChatInput(sessionId: string): Promise<ChatInputData | null> {
    try {
      const data = await this.storage.getItem<ChatInputData>(sessionId);
      return data || null;
    } catch (error) {
      console.error("获取聊天输入失败:", error);
      return null;
    }
  }

  async deleteChatInput(sessionId: string): Promise<boolean> {
    try {
      await this.storage.removeItem(sessionId);
      return true;
    } catch (error) {
      console.error("删除聊天输入失败:", error);
      return false;
    }
  }

  // 获取所有会话ID
  async getAllSessionIds(): Promise<string[]> {
    try {
      const keys = await this.storage.keys();
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
