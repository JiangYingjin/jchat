// import { StoreKey } from "../constant";
// import { jchatLocalForage } from "./store";

// /**
//  * 数据迁移工具
//  * 在应用启动时执行，避免在 zustand persist 中间件中出现异步问题
//  */
// export class DataMigration {
//   private static readonly MIGRATION_FLAG = "data-migration-completed";
//   private static readonly MIGRATION_VERSION = "1.0.0";

//   /**
//    * 检查是否已经完成数据迁移
//    */
//   private static async isMigrationCompleted(): Promise<boolean> {
//     try {
//       const flag = await jchatLocalForage.getItem(this.MIGRATION_FLAG);
//       return flag === this.MIGRATION_VERSION;
//     } catch (error) {
//       console.error("[Migration] 检查迁移状态失败:", error);
//       return false;
//     }
//   }

//   /**
//    * 标记数据迁移完成
//    */
//   private static async markMigrationCompleted(): Promise<void> {
//     try {
//       await jchatLocalForage.setItem(
//         this.MIGRATION_FLAG,
//         this.MIGRATION_VERSION,
//       );
//     } catch (error) {
//       console.error("[Migration] 标记迁移完成失败:", error);
//     }
//   }

//   /**
//    * 迁移单个存储键的数据
//    */
//   private static async migrateStore(
//     oldKey: string,
//     newKey: string,
//     storeName: string,
//   ): Promise<boolean> {
//     try {
//       // 删除新键数据（如果存在）
//       await jchatLocalForage.removeItem(newKey);
//       console.log(`[Migration] ${storeName} 已删除新键数据`);

//       // 获取旧键的数据
//       const oldData = await jchatLocalForage.getItem(oldKey);
//       console.log(`[Migration] ${storeName} 旧键数据：`, oldData);
//       if (!oldData) {
//         console.log(`[Migration] ${storeName} 旧键无数据，跳过迁移`);
//         return true;
//       }

//       // 将旧数据复制到新键
//       await jchatLocalForage.setItem(newKey, oldData);
//       console.log(
//         `[Migration] ${storeName} 数据迁移成功：${oldKey} → ${newKey}`,
//       );

//       const newData = await jchatLocalForage.getItem(newKey);
//       console.log(`[Migration] ${storeName} 新键数据：`, newData);

//       // 保留原始数据不删除，按用户要求
//       console.log(`[Migration] ${storeName} 保留原始数据`);

//       return true;
//     } catch (error) {
//       console.error(`[Migration] ${storeName} 数据迁移失败:`, error);
//       return false;
//     }
//   }

//   /**
//    * 执行所有数据迁移
//    */
//   public static async migrateAll(): Promise<void> {
//     console.log("[Migration] 开始检查数据迁移...");

//     const migrations = [
//       {
//         oldKey: "chat-next-web-store",
//         newKey: "chats",
//         storeName: "ChatStore",
//       },
//     ];

//     let allSuccess = true;
//     for (const migration of migrations) {
//       const success = await this.migrateStore(
//         migration.oldKey,
//         migration.newKey,
//         migration.storeName,
//       );
//       if (!success) {
//         allSuccess = false;
//       }
//     }

//     if (allSuccess) {
//       await this.markMigrationCompleted();
//       console.log("[Migration] 所有数据迁移完成");
//     } else {
//       console.error("[Migration] 部分数据迁移失败");
//     }
//   }

//   /**
//    * 重置迁移状态（用于测试）
//    */
//   public static async resetMigration(): Promise<void> {
//     try {
//       await jchatLocalForage.removeItem(this.MIGRATION_FLAG);
//       console.log("[Migration] 迁移状态已重置");
//     } catch (error) {
//       console.error("[Migration] 重置迁移状态失败:", error);
//     }
//   }
// }
