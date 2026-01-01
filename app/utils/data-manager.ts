// 全新的数据导入导出管理器
// 支持完整的 IndexedDB 数据备份和恢复

import localforage from "localforage";
import { useChatStore } from "../store/chat";
import { messageStorage } from "../store/message";
import { systemMessageStorage } from "../store/system";
import { chatInputStorage } from "../store/input";
import { jchatStorage } from "./store";
import {
  downloadBlob,
  readFromFile,
  jsonStringifyOffMainThread,
} from "../utils";
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

      const values = await Promise.all(keys.map((k) => store.getItem(k)));
      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (value !== null) {
          data[keys[i]] = value;
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

      await store.clear();

      const entries = Object.entries(data).filter(
        ([, value]) => value !== null && value !== undefined,
      );

      // 优化：小数据量直接写入，大数据量分批处理
      if (entries.length <= 100) {
        await Promise.all(entries.map(([k, v]) => store.setItem(k, v)));
      } else {
        const batchSize = 50;
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize);
          await Promise.all(batch.map(([k, v]) => store.setItem(k, v)));
          // 只在非最后一批时让出主线程
          if (i + batchSize < entries.length) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      }

      console.log(
        `[DataManager] 成功恢复存储桶 ${storeName}，共 ${entries.length} 项数据`,
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

      // 并发获取所有存储桶的数据（限制在单个 Promise.all 中完成，以避免额外的事件循环阻塞）
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

      // 生成文件名并开始序列化
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const datePart = `${year}${month}${day}-${hours}${minutes}${seconds}`;
      const fileName = `JChat-Backup-${datePart}.json.gz`;

      showToast("正在生成导出文件...");

      // 使用 Web Worker 进行 JSON 序列化，完全避免阻塞主线程
      let jsonText = await jsonStringifyOffMainThread(backupData);

      let blob: Blob;

      // 使用 gzip 压缩
      if (typeof CompressionStream !== "undefined") {
        showToast("正在 Gzip 压缩...");

        // 创建 gzip 压缩流
        const jsonBlob = new Blob([jsonText], { type: "application/json" });
        const compressedStream = jsonBlob
          .stream()
          .pipeThrough(new CompressionStream("gzip"));

        // 将 ReadableStream 转换为 Uint8Array
        const chunks: Uint8Array[] = [];
        const reader = compressedStream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // 合并所有块
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        blob = new Blob([result], { type: "application/gzip" });
      } else {
        blob = new Blob([jsonText], { type: "application/json" });
      }

      await downloadBlob(blob, fileName);

      showToast(
        `导出成功！包含 ${totalSessions} 个会话，${totalMessages} 条消息`,
      );
    } catch (error) {
      console.error("[DataManager] 导出数据失败:", error);
      showToast("导出失败，请检查控制台获取详细信息");
    }
  }

  /**
   * 检测是否是原始 IndexedDB 导出格式（来自 exportIndexedDB.js）
   */
  private isRawIndexedDBExport(data: any): boolean {
    if (!data || typeof data !== "object") return false;

    // 原始格式：直接包含 objectStore 名称作为键，值为数组
    const expectedStores = [
      "default",
      "messages",
      "systemMessages",
      "chatInput",
    ];
    const hasStoreKeys = expectedStores.some((store) => store in data);

    // 如果包含 objectStore 名称，且没有 version/timestamp/data 结构，则是原始格式
    return (
      hasStoreKeys &&
      !("version" in data) &&
      !("timestamp" in data) &&
      !("data" in data)
    );
  }

  /**
   * 将原始 IndexedDB 导出格式转换为 JChatBackupData 格式
   */
  private convertRawIndexedDBExport(rawData: any): JChatBackupData {
    const convertedData: JChatBackupData = {
      version: this.CURRENT_VERSION,
      timestamp: Date.now(),
      metadata: {
        totalSessions: 0,
        totalMessages: 0,
        exportSource: "IndexedDB Raw Export",
      },
      data: {
        default: {},
        messages: {},
        systemMessages: {},
        chatInput: {},
      },
    };

    // 处理每个 objectStore
    const storeNames = ["default", "messages", "systemMessages", "chatInput"];
    for (const storeName of storeNames) {
      if (!(storeName in rawData) || !Array.isArray(rawData[storeName])) {
        continue;
      }

      const storeArray = rawData[storeName];
      const storeData: Record<string, any> = {};

      for (let i = 0; i < storeArray.length; i++) {
        const item = storeArray[i];
        // 新格式：{ key: ..., value: ... }
        if (
          item &&
          typeof item === "object" &&
          "key" in item &&
          "value" in item
        ) {
          const key = String(item.key);
          storeData[key] = item.value;
        }
        // 旧格式：只有值（向后兼容，但无法恢复键，使用索引作为键）
        else {
          // 警告：旧格式无法恢复原始键，使用索引作为临时键
          if (i === 0) {
            console.warn(
              `[DataManager] 检测到旧格式导出数据（${storeName}），无法恢复原始键，将使用索引作为键`,
            );
          }
          storeData[`_imported_${i}`] = item;
        }
      }

      convertedData.data[storeName as keyof typeof convertedData.data] =
        storeData;

      // 统计信息
      if (storeName === "messages") {
        convertedData.metadata.totalSessions = Object.keys(storeData).length;
        convertedData.metadata.totalMessages = Object.values(storeData).reduce(
          (sum, messages) =>
            sum + (Array.isArray(messages) ? messages.length : 0),
          0,
        );
      }
    }

    return convertedData;
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

      // 读取文件内容（支持 JSON 和 gzip）
      const fileData = await readFromFile();

      if (fileData.isGzip) {
        showToast("正在解压 gzip 文件...");
      }

      showToast("正在解析备份数据...");

      // 解析 JSON 数据
      const parsedData = JSON.parse(fileData.content);

      let backupData: JChatBackupData;

      // 检测是否是原始 IndexedDB 导出格式
      if (this.isRawIndexedDBExport(parsedData)) {
        showToast("检测到 IndexedDB 原始导出格式，正在转换...");
        backupData = this.convertRawIndexedDBExport(parsedData);
      } else {
        // 验证标准备份数据格式
        if (!this.validateBackupData(parsedData)) {
          throw new Error("备份文件格式不正确或版本不兼容");
        }
        backupData = parsedData;
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
      } else if (
        error instanceof TypeError &&
        error.message.includes("DecompressionStream")
      ) {
        errorMessage = "gzip 解压失败，请确保浏览器支持 gzip 解压功能";
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

  /**
   * 检测浏览器是否支持 gzip 解压
   */
  private isGzipSupported(): boolean {
    return typeof DecompressionStream !== "undefined";
  }
}

// 导出单例实例
export const jchatDataManager = new JChatDataManager();
