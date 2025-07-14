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
    if (!isClient) {
      return null;
    }
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
    // console.log("[MessageStorage] 💾 开始保存消息到 IndexedDB", {
    //   sessionId,
    //   messageCount: messages?.length || 0,
    //   isClient: typeof window !== "undefined",
    //   timestamp: new Date().toISOString(),
    // });

    try {
      const storage = this.getStorage();
      if (!storage) {
        console.warn("[MessageStorage] ⚠️ 存储实例为空 (服务器端?)", {
          sessionId,
          isClient: typeof window !== "undefined",
        });
        return false;
      }

      // console.log("[MessageStorage] 🔄 准备写入 IndexedDB", {
      //   sessionId,
      //   messageCount: messages?.length || 0,
      //   messagesPreview:
      //     messages?.slice(0, 3).map((m) => ({
      //       id: m.id,
      //       role: m.role,
      //       streaming: m.streaming,
      //       contentSnippet:
      //         typeof m.content === "string"
      //           ? m.content.substring(0, 50) + "..."
      //           : `[Object: ${JSON.stringify(m.content).substring(0, 50)}...]`,
      //     })) || [],
      // });

      // 添加超时处理
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("IndexedDB operation timeout")),
          5000,
        );
      });

      const savePromise = storage.setItem(sessionId, messages);

      await Promise.race([savePromise, timeoutPromise]);

      // console.log("[MessageStorage] ✅ 成功保存到 IndexedDB", {
      //   sessionId,
      //   messageCount: messages?.length || 0,
      //   timestamp: new Date().toISOString(),
      // });

      return true;
    } catch (error) {
      console.error(`[MessageStorage] ❌ 保存消息失败: ${sessionId}`, error);
      console.error("[MessageStorage] 错误详情:", {
        sessionId,
        messageCount: messages?.length || 0,
        errorMessage: (error as Error)?.message || String(error),
        errorStack: (error as Error)?.stack,
        isClient: typeof window !== "undefined",
      });
      console.error("[MessageStorage] 如果问题持续存在，请重启浏览器重试");
      return false;
    }
  }

  /**
   * 检查 IndexedDB 是否正常工作
   */
  async healthCheck(): Promise<boolean> {
    try {
      const storage = this.getStorage();
      if (!storage) return false;

      const testKey = "__health_check__";
      const testValue = { timestamp: Date.now() };

      // 超时保护
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Health check timeout")), 3000);
      });

      // 测试写入
      const writePromise = storage.setItem(testKey, testValue);
      await Promise.race([writePromise, timeoutPromise]);

      // 测试读取
      const readPromise = storage.getItem(testKey);
      const result = await Promise.race([readPromise, timeoutPromise]);

      // 清理测试数据
      await storage.removeItem(testKey);

      return result !== null;
    } catch (error) {
      console.error("[MessageStorage] 健康检查失败", error);
      console.error("[MessageStorage] 如果问题持续存在，请重启浏览器重试");
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
