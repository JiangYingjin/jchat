// 全新的数据导入导出管理器
// 支持完整的 IndexedDB 数据备份和恢复

import localforage from "localforage";
import { useChatStore } from "../store/chat";
import { messageStorage } from "../store/message";
import { systemMessageStorage } from "../store/system";
import { chatInputStorage } from "../store/input";
import { jchatStorage } from "./store";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";

// 完整的备份数据结构
export interface JChatBackupData {
  version: string;
  timestamp: number;
  metadata: {
    totalSessions: number;
    totalMessages: number;
    exportSource: string;
  };
  data: {
    // 默认存储桶：zustand store 状态（聊天会话元数据、用户设置等）
    default: Record<string, any>;
    // 消息存储桶：所有会话的消息数据
    messages: Record<string, any[]>;
    // 系统消息存储桶：所有会话的系统提示词
    systemMessages: Record<string, any>;
    // 聊天输入存储桶：所有会话的输入状态
    chatInput: Record<string, any>;
  };
}

class JChatDataManager {
  private readonly CURRENT_VERSION = "2.0.0";
  private readonly isClient = typeof window !== "undefined";

  /**
   * 获取指定存储桶的所有数据
   */
  private async getAllDataFromStore(
    storeName: string,
  ): Promise<Record<string, any>> {
    if (!this.isClient) return {};

    try {
      const store = localforage.createInstance({
        name: "JChat",
        storeName: storeName,
      });

      const keys = await store.keys();
      const data: Record<string, any> = {};

      for (const key of keys) {
        const value = await store.getItem(key);
        if (value !== null) {
          data[key] = value;
        }
      }

      return data;
    } catch (error) {
      console.error(`[DataManager] 获取存储桶 ${storeName} 数据失败:`, error);
      return {};
    }
  }

  /**
   * 将数据批量写入指定存储桶
   */
  private async setAllDataToStore(
    storeName: string,
    data: Record<string, any>,
  ): Promise<void> {
    if (!this.isClient) return;

    try {
      const store = localforage.createInstance({
        name: "JChat",
        storeName: storeName,
      });

      // 先清空现有数据
      await store.clear();

      // 批量写入新数据
      for (const [key, value] of Object.entries(data)) {
        if (value !== null && value !== undefined) {
          await store.setItem(key, value);
        }
      }

      console.log(
        `[DataManager] 成功恢复存储桶 ${storeName}，共 ${Object.keys(data).length} 项数据`,
      );
    } catch (error) {
      console.error(`[DataManager] 恢复存储桶 ${storeName} 数据失败:`, error);
      throw error;
    }
  }

  /**
   * 导出完整的 JChat 数据
   */
  async exportData(): Promise<void> {
    if (!this.isClient) {
      showToast("导出功能仅在客户端环境可用");
      return;
    }

    try {
      showToast("正在导出数据...");

      // 并行获取所有存储桶的数据
      const [defaultData, messagesData, systemMessagesData, chatInputData] =
        await Promise.all([
          this.getAllDataFromStore("default"),
          this.getAllDataFromStore("messages"),
          this.getAllDataFromStore("systemMessages"),
          this.getAllDataFromStore("chatInput"),
        ]);

      // 计算统计信息
      const totalSessions = Object.keys(messagesData).length;
      const totalMessages = Object.values(messagesData).reduce(
        (sum, messages) =>
          sum + (Array.isArray(messages) ? messages.length : 0),
        0,
      );

      // 构建完整的备份数据
      const backupData: JChatBackupData = {
        version: this.CURRENT_VERSION,
        timestamp: Date.now(),
        metadata: {
          totalSessions,
          totalMessages,
          exportSource: "JChat Desktop",
        },
        data: {
          default: defaultData,
          messages: messagesData,
          systemMessages: systemMessagesData,
          chatInput: chatInputData,
        },
      };

      // 生成文件名
      const datePart = new Date().toLocaleString().replace(/[/:]/g, "-");
      const fileName = `JChat-Backup-${datePart}.json`;

      // 下载文件
      downloadAs(JSON.stringify(backupData, null, 2), fileName);

      showToast(
        `导出成功！包含 ${totalSessions} 个会话，${totalMessages} 条消息`,
      );
    } catch (error) {
      console.error("[DataManager] 导出数据失败:", error);
      showToast("导出失败，请检查控制台获取详细信息");
    }
  }

  /**
   * 导入并恢复 JChat 数据
   */
  async importData(): Promise<void> {
    if (!this.isClient) {
      showToast("导入功能仅在客户端环境可用");
      return;
    }

    try {
      showToast("正在读取备份文件...");

      // 读取文件内容
      const rawContent = await readFromFile();

      showToast("正在解析备份数据...");

      // 解析 JSON 数据
      const backupData = JSON.parse(rawContent);

      // 验证备份数据格式
      if (!this.validateBackupData(backupData)) {
        throw new Error("备份文件格式不正确或版本不兼容");
      }

      showToast("正在恢复数据到 IndexedDB...");

      // 并行恢复所有存储桶的数据
      await Promise.all([
        this.setAllDataToStore("default", backupData.data.default),
        this.setAllDataToStore("messages", backupData.data.messages),
        this.setAllDataToStore(
          "systemMessages",
          backupData.data.systemMessages,
        ),
        this.setAllDataToStore("chatInput", backupData.data.chatInput),
      ]);

      showToast("数据恢复完成，正在重新加载应用...");

      // 短暂延迟后重新加载页面，确保所有存储操作完成
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("[DataManager] 导入数据失败:", error);

      let errorMessage = "导入失败";
      if (error instanceof SyntaxError) {
        errorMessage = "备份文件格式错误，请检查文件是否正确";
      } else if (error instanceof Error) {
        errorMessage = `导入失败: ${error.message}`;
      }

      showToast(errorMessage);
    }
  }

  /**
   * 验证备份数据的有效性
   */
  private validateBackupData(data: any): data is JChatBackupData {
    try {
      // 检查基本结构
      if (!data || typeof data !== "object") return false;
      if (!data.version || !data.timestamp || !data.data) return false;

      // 检查数据结构
      const { data: backupDataContent } = data;
      if (
        !backupDataContent.default ||
        typeof backupDataContent.default !== "object"
      )
        return false;
      if (
        !backupDataContent.messages ||
        typeof backupDataContent.messages !== "object"
      )
        return false;
      if (
        !backupDataContent.systemMessages ||
        typeof backupDataContent.systemMessages !== "object"
      )
        return false;
      if (
        !backupDataContent.chatInput ||
        typeof backupDataContent.chatInput !== "object"
      )
        return false;

      // 检查版本兼容性
      const majorVersion = parseInt(data.version.split(".")[0]);
      const currentMajorVersion = parseInt(this.CURRENT_VERSION.split(".")[0]);

      if (majorVersion > currentMajorVersion) {
        throw new Error(
          `备份文件版本 ${data.version} 过新，当前应用版本 ${this.CURRENT_VERSION} 不支持`,
        );
      }

      if (majorVersion < currentMajorVersion) {
        throw new Error(
          `备份文件版本 ${data.version} 过旧，当前应用版本不再支持旧版本数据格式`,
        );
      }

      return true;
    } catch (error) {
      console.error("[DataManager] 验证备份数据失败:", error);
      return false;
    }
  }

  /**
   * 获取数据库统计信息
   */
  async getDatabaseStats(): Promise<{
    sessions: number;
    messages: number;
    systemMessages: number;
    chatInputs: number;
  }> {
    if (!this.isClient) {
      return { sessions: 0, messages: 0, systemMessages: 0, chatInputs: 0 };
    }

    try {
      const [messagesData, systemMessagesData, chatInputData] =
        await Promise.all([
          this.getAllDataFromStore("messages"),
          this.getAllDataFromStore("systemMessages"),
          this.getAllDataFromStore("chatInput"),
        ]);

      const sessions = Object.keys(messagesData).length;
      const messages = Object.values(messagesData).reduce(
        (sum, messageArray) =>
          sum + (Array.isArray(messageArray) ? messageArray.length : 0),
        0,
      );
      const systemMessages = Object.keys(systemMessagesData).length;
      const chatInputs = Object.keys(chatInputData).length;

      return { sessions, messages, systemMessages, chatInputs };
    } catch (error) {
      console.error("[DataManager] 获取数据库统计信息失败:", error);
      return { sessions: 0, messages: 0, systemMessages: 0, chatInputs: 0 };
    }
  }

  /**
   * 清理所有数据（危险操作，需要确认）
   */
  async clearAllData(): Promise<void> {
    if (!this.isClient) return;

    try {
      const stores = ["default", "messages", "systemMessages", "chatInput"];

      await Promise.all(
        stores.map(async (storeName) => {
          const store = localforage.createInstance({
            name: "JChat",
            storeName: storeName,
          });
          await store.clear();
        }),
      );

      console.log("[DataManager] 所有数据已清理");
    } catch (error) {
      console.error("[DataManager] 清理数据失败:", error);
      throw error;
    }
  }
}

// 导出单例实例
export const jchatDataManager = new JChatDataManager();
