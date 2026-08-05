"use client";

import { useEffect, useRef } from "react";
import { jchatDataManager } from "../utils/data-manager";

const CHECK_INTERVAL_MS = 60_000; // 保底：每分钟检查一次是否该备份
const IDLE_MS = 120_000; // 无交互超过该时长视为空闲窗口

/**
 * 全局定时备份调度器：仅在「页面不可见或无交互」的安全窗口执行备份，
 * 避免备份（全量读取 IndexedDB + 写文件系统）与用户输入竞争主线程导致卡顿。
 * 打开页面（恢复可见）时绝不立即备份，先保证交互流畅，备份顺延到空闲窗口。
 */
export function AutoBackupScheduler() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const lastInteractionRef = useRef(Date.now());

  useEffect(() => {
    if (!jchatDataManager.isBackupToDirectorySupported()) return;

    const runBackup = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      pendingRef.current = false;
      try {
        // 先记录时间，备份失败也不会无限重试
        await jchatDataManager.setLastBackupTime(Date.now());
        const { ok, message } = await jchatDataManager.writeBackupToDirectory();
        if (!ok && message) {
          console.warn("[AutoBackupScheduler]", message);
        }
      } finally {
        runningRef.current = false;
      }
    };

    const checkDue = async (): Promise<boolean> => {
      const config = await jchatDataManager.getAutoBackupConfig();
      if (!config.enabled) return false;
      const handle = await jchatDataManager.getStoredBackupDirHandle();
      if (!handle) return false;
      const last = await jchatDataManager.getLastBackupTime();
      const intervalMs = config.intervalMinutes * 60 * 1000;
      if (last > 0 && Date.now() - last < intervalMs) return false;
      return true;
    };

    // 仅在安全窗口（页面不可见或无交互）执行
    const tryRun = async () => {
      if (runningRef.current || !pendingRef.current) return;
      const idle = Date.now() - lastInteractionRef.current >= IDLE_MS;
      if (!document.hidden && !idle) return;
      await runBackup();
    };

    const tick = async () => {
      if (runningRef.current) return;
      pendingRef.current = await checkDue();
      if (pendingRef.current) await tryRun();
    };

    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // 缩托盘瞬间：用户看不见页面，立即执行到点备份
        tick();
      } else {
        // 打开瞬间：视为刚交互，绝不立即备份
        markInteraction();
      }
    };

    intervalRef.current = setInterval(tick, CHECK_INTERVAL_MS);
    tick();

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("keydown", markInteraction, { passive: true });
    document.addEventListener("pointerdown", markInteraction, {
      passive: true,
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("keydown", markInteraction);
      document.removeEventListener("pointerdown", markInteraction);
    };
  }, []);

  return null;
}
