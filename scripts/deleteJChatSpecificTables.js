/**
 * 删除 IndexedDB 中 'JChat' 数据库的 'chatInput' 和 'systemMessages' 表。
 * 注意：IndexedDB 不提供直接删除表的 API。
 *       通常的做法是删除整个数据库，或者创建一个新版本的数据库，
 *       在新版本中不包含要删除的对象存储。
 *       这个函数将采取后者：它会尝试打开数据库，如果存在这些表，
 *       它会尝试升级数据库版本并删除这些表。
 *       这会触发 onupgradeneeded 事件。
 *
 * @returns {Promise<string>} 一个 Promise，解析为操作成功或失败的消息。
 */
async function deleteJChatSpecificTables() {
  const DB_NAME = "JChat";
  const TABLES_TO_DELETE = ["chatInput_v2", "systemMessages_v2"];

  return new Promise(async (resolve, reject) => {
    let db;

    try {
      // 1. 尝试打开数据库，以获取当前版本
      // 这里我们用一个临时的请求来获取版本，不等待它完成，
      // 而是等待 onsuccess 或 onerror 来确定版本。
      const initialRequest = indexedDB.open(DB_NAME);

      initialRequest.onsuccess = async (event) => {
        db = event.target.result;
        const currentVersion = db.version;
        db.close(); // 关闭初始连接，以便后续升级可以进行

        console.log(
          `[IndexedDB] Found JChat database, current version: ${currentVersion}`,
        );

        // 2. 尝试以新版本打开数据库，触发 onupgradeneeded
        const upgradeRequest = indexedDB.open(DB_NAME, currentVersion + 1);

        upgradeRequest.onupgradeneeded = (upgradeEvent) => {
          const upgradeDb = upgradeEvent.target.result;
          const transaction = upgradeEvent.target.transaction; // 获取升级事务

          console.log(
            `[IndexedDB] Upgrading JChat from version ${upgradeEvent.oldVersion} to ${upgradeEvent.newVersion}`,
          );

          TABLES_TO_DELETE.forEach((tableName) => {
            if (upgradeDb.objectStoreNames.contains(tableName)) {
              upgradeDb.deleteObjectStore(tableName);
              console.log(`[IndexedDB] Deleted object store: ${tableName}`);
            } else {
              console.log(
                `[IndexedDB] Object store '${tableName}' not found, skipping deletion.`,
              );
            }
          });

          // 确保升级事务完成
          transaction.oncomplete = () => {
            console.log(
              `[IndexedDB] Database upgrade for ${DB_NAME} completed successfully.`,
            );
          };

          transaction.onerror = (txError) => {
            console.error(
              `[IndexedDB] Database upgrade transaction failed:`,
              txError,
            );
            reject(
              `Failed to upgrade JChat database: ${txError.target.error.message}`,
            );
          };
        };

        upgradeRequest.onsuccess = (upgradeEvent) => {
          const upgradedDb = upgradeEvent.target.result;
          upgradedDb.close(); // 关闭新连接
          resolve(
            `Successfully deleted 'chatInput' and 'systemMessages' from JChat database.`,
          );
        };

        upgradeRequest.onerror = (error) => {
          console.error(
            `[IndexedDB] Error opening database for upgrade:`,
            error,
          );
          reject(
            `Failed to open JChat database for upgrade: ${error.target.error.message}`,
          );
        };
      };

      initialRequest.onerror = (event) => {
        const error = event.target.error;
        if (error && error.name === "NotFoundError") {
          // 数据库不存在，无需删除
          console.log(
            `[IndexedDB] JChat database not found. No tables to delete.`,
          );
          resolve(`JChat database does not exist. No tables deleted.`);
        } else {
          console.error(`[IndexedDB] Error accessing JChat database:`, error);
          reject(
            `Failed to access JChat database: ${error ? error.message : "Unknown error"}`,
          );
        }
      };
    } catch (error) {
      console.error(`[IndexedDB] Unexpected error:`, error);
      reject(`An unexpected error occurred: ${error.message}`);
    }
  });
}

// --- 如何使用这个函数 ---
// 在浏览器环境中执行，例如点击按钮时：
/*
document.getElementById('deleteTablesBtn').addEventListener('click', async () => {
    try {
        const message = await deleteJChatSpecificTables();
        console.log(message);
        alert(message);
    } catch (error) {
        console.error("Operation failed:", error);
        alert("Error: " + error);
    }
});
*/

// 或者直接调用 (在支持 async/await 的环境中，如现代浏览器控制台)
(async () => {
  try {
    const message = await deleteJChatSpecificTables();
    console.log(message);
  } catch (error) {
    console.error("Operation failed:", error);
  }
})();
