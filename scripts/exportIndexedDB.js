/**
 * 导出指定 IndexedDB 数据库的所有数据。
 * @param {string} dbName 数据库名称 (例如: 'JChat')
 * @returns {Promise<Object>} 包含所有数据的对象。
 */
async function exportIndexedDB(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    let db;
    const exportedData = {};

    request.onerror = (event) => {
      console.error(
        `Error opening database ${dbName}:`,
        event.target.errorCode,
      );
      reject(`Error opening database ${dbName}: ${event.target.errorCode}`);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      const transaction = db.transaction(db.objectStoreNames, "readonly");
      let completedStores = 0;

      if (db.objectStoreNames.length === 0) {
        console.warn(`Database ${dbName} has no object stores.`);
        resolve(exportedData);
        db.close();
        return;
      }

      for (const storeName of db.objectStoreNames) {
        const store = transaction.objectStore(storeName);
        const storeData = [];
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            // 导出键值对格式，保留键信息以便导入时恢复
            storeData.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          } else {
            // No more entries in this store
            exportedData[storeName] = storeData;
            completedStores++;

            if (completedStores === db.objectStoreNames.length) {
              db.close();
              resolve(exportedData);
            }
          }
        };

        cursorRequest.onerror = (e) => {
          console.error(
            `Error opening cursor for store ${storeName}:`,
            e.target.errorCode,
          );
          reject(
            `Error opening cursor for store ${storeName}: ${e.target.errorCode}`,
          );
          db.close();
        };
      }

      transaction.oncomplete = () => {
        // All object stores have been processed, resolve is already called by cursor loop
      };

      transaction.onerror = (event) => {
        console.error(
          `Transaction error for database ${dbName}:`,
          event.target.errorCode,
        );
        reject(
          `Transaction error for database ${dbName}: ${event.target.errorCode}`,
        );
        db.close();
      };
    };
  });
}

/**
 * 将数据下载为 JSON 文件。
 * @param {Object} data 要下载的数据对象。
 * @param {string} filename 文件名 (例如: 'jchat_data.json')
 */
function downloadJSON(data, filename) {
  const jsonString = JSON.stringify(data, null, 2); // 格式化 JSON
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); // 必须添加到DOM才能触发点击
  a.click();
  document.body.removeChild(a); // 清理
  URL.revokeObjectURL(url); // 释放URL对象
}

// --- 执行导出 ---
// 替换 'JChat' 为实际的数据库名称
// 你可以通过在开发者工具的 Application -> IndexedDB 中查看来确认数据库名称。
const JCHAT_DB_NAME = "JChat"; // 请确保这是正确的数据库名称！

console.log(`尝试导出 IndexedDB 数据库: ${JCHAT_DB_NAME}`);

exportIndexedDB(JCHAT_DB_NAME)
  .then((data) => {
    console.log(`成功导出 ${JCHAT_DB_NAME} 数据库数据:`, data);
    downloadJSON(data, `jchat_indexeddb_export_${Date.now()}.json`);
  })
  .catch((error) => {
    console.error(`导出 ${JCHAT_DB_NAME} 数据库失败:`, error);
    alert(
      `导出失败：${error}。请检查控制台以获取更多信息，并确认数据库名称和上下文是否正确。`,
    );
  });
