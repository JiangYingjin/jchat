"use client";

import { useEffect, useRef } from "react";
import { jchatDataManager } from "../utils/data-manager";

const CHECK_INTERVAL_MS = 60_000; // 每分钟检查一次是否该备份

/**
 * 全局定时备份调度器：在客户端根据配置定期调用写入备份目录。
 * 仅当用户已开启且已选择目录时才会执行，不包含任何个人路径。
 */
export function AutoBackupScheduler() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jchatDataManager.isBackupToDirectorySupported()) return;

    const tick = async () => {
      const config = await jchatDataManager.getAutoBackupConfig();
      if (!config.enabled) return;
      const handle = await jchatDataManager.getStoredBackupDirHandle();
      if (!handle) return;

      const last = await jchatDataManager.getLastBackupTime();
      const now = Date.now();
      const intervalMs = config.intervalMinutes * 60 * 1000;
      if (last > 0 && now - last < intervalMs) return;

      const { ok, message } = await jchatDataManager.writeBackupToDirectory();
      if (ok) {
        await jchatDataManager.setLastBackupTime(now);
      } else if (message) {
        console.warn("[AutoBackupScheduler]", message);
      }
    };

    intervalRef.current = setInterval(tick, CHECK_INTERVAL_MS);
    tick();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return null;
}
