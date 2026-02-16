"use client";

// --- 1. Imports ---
// Grouped by type for clarity and better organization.

// React and Hooks
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

// State Management
import { useChatStore } from "../store";
import { useMobileScreen } from "../utils";
import { jchatDataManager, type AutoBackupConfig } from "../utils/data-manager";

// UI Components
import { List, ListItem, showToast } from "./ui-lib";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";

// Icons and Styles
import styles from "../styles/settings.module.scss";
import CloseIcon from "../icons/close.svg";
import DownloadIcon from "../icons/download.svg";
import UploadIcon from "../icons/upload.svg";
import EyeIcon from "../icons/eye.svg";

// Utilities and Constants
import Locale from "../locales";
import { Path } from "../constant";
import { checkAndHandleAuth } from "../utils/auth";

// --- 2. Main Exported Component ---
// The primary component of this file, placed at the top for easy discoverability.

/**
 * The main Settings page component.
 * It serves as the container for all settings sections and handles
 * page-level logic like navigation and authentication checks.
 */
export function Settings() {
  const router = useRouter();
  const isMobileScreen = useMobileScreen();
  const chatStore = useChatStore();

  const goHome = () => {
    if (isMobileScreen) {
      chatStore.showChatOnMobile();
      router.push(Path.Home);
    } else {
      router.push(Path.Home);
    }
  };

  // Effect for checking authentication when the component mounts.
  useEffect(() => {
    checkAndHandleAuth(() => router.push(Path.Auth));
  }, [router]);

  // Effect for handling the 'Escape' key to close the settings page.
  useEffect(() => {
    const keydownEvent = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isMobileScreen) {
          chatStore.showSidebarOnMobile();
        } else {
          goHome();
        }
      }
    };
    document.addEventListener("keydown", keydownEvent);
    return () => {
      document.removeEventListener("keydown", keydownEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen, chatStore]);

  return (
    <ErrorBoundary>
      <div className="window-header">
        <div className="window-header-title">
          <div className="window-header-main-title">
            {Locale.Settings.Title}
          </div>
          <div className="window-header-sub-title">
            {Locale.Settings.SubTitle}
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button"></div>
          <div className="window-action-button"></div>
          <div className="window-action-button">
            <IconButton
              aria={Locale.UI.Close}
              icon={<CloseIcon />}
              onClick={() => {
                if (isMobileScreen) {
                  chatStore.showSidebarOnMobile();
                } else {
                  goHome();
                }
              }}
              bordered
            />
          </div>
        </div>
      </div>

      <div className={styles["settings"]}>
        <LocalDataItems />
      </div>
    </ErrorBoundary>
  );
}

// --- 3. Helper Sub-components ---
// Internal components used only within this file.

/**
 * A component responsible for displaying local data statistics
 * and providing options to import/export chat data.
 */
function LocalDataItems() {
  const chatStore = useChatStore();
  const [showOverrideApiKey, setShowOverrideApiKey] = useState(false);
  const [databaseStats, setDatabaseStats] = useState({
    sessions: 0,
    messages: 0,
    systemMessages: 0,
    chatInputs: 0,
  });
  const [exporting, setExporting] = useState(false);

  // Asynchronously load real database statistics on component mount.
  useEffect(() => {
    const loadDatabaseStats = async () => {
      try {
        const stats = await jchatDataManager.getDatabaseStats();
        setDatabaseStats(stats);
      } catch (error) {
        console.error("加载数据库统计信息失败:", error);
      }
    };

    loadDatabaseStats();
  }, []);

  // Memoize the overview statistics to avoid recalculation on every render.
  const stateOverview = useMemo(() => {
    const sessions = chatStore.sessions;
    // Provide a fallback for message count for backward compatibility.
    const fallbackMessageCount = sessions.reduce(
      (p, c) => p + c.messageCount,
      0,
    );

    return {
      chat: Math.max(sessions.length, databaseStats.sessions),
      message:
        databaseStats.messages > 0
          ? databaseStats.messages
          : fallbackMessageCount,
      mask: 0,
    };
  }, [chatStore.sessions, databaseStats]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await jchatDataManager.exportData();
    } catch (error) {
      console.error("导出失败:", error);
      showToast("导出失败，请检查控制台");
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    try {
      await jchatDataManager.importData();
    } catch (error) {
      console.error("导入失败:", error);
      showToast(Locale.Settings.LocalData.ImportFailed);
    }
  };

  return (
    <List>
      <ListItem
        title={Locale.Settings.LocalData.LocalState}
        subTitle={
          databaseStats.sessions > 0
            ? `${databaseStats.sessions} 组会话，${databaseStats.messages + databaseStats.systemMessages} 条消息`
            : Locale.Settings.LocalData.Overview(stateOverview)
        }
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <IconButton
            aria={Locale.Settings.LocalData.LocalState + Locale.UI.Export}
            icon={<UploadIcon />}
            text={Locale.UI.Export}
            onClick={handleExport}
            disabled={exporting}
            loding={exporting}
          />
          <IconButton
            aria={Locale.Settings.LocalData.LocalState + Locale.UI.Import}
            icon={<DownloadIcon />}
            text={Locale.UI.Import}
            onClick={handleImport}
          />
        </div>
      </ListItem>
      <ListItem
        title={Locale.Settings.Mem0.Title}
        subTitle={Locale.Settings.Mem0.SubTitle}
      >
        <input
          type="text"
          className={styles["mem0-input"]}
          placeholder={Locale.Settings.Mem0.Placeholder}
          value={chatStore.user_id}
          onChange={(e) => chatStore.setUserId(e.target.value)}
          aria-label={Locale.Settings.Mem0.Title}
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.OverrideApiKey.Title}
        subTitle={Locale.Settings.OverrideApiKey.SubTitle}
      >
        <div className={styles["api-key-wrap"]}>
          <input
            type={showOverrideApiKey ? "text" : "password"}
            className={styles["api-key-input"]}
            placeholder={Locale.Settings.OverrideApiKey.Placeholder}
            value={chatStore.overrideApiKey}
            onChange={(e) => chatStore.setOverrideApiKey(e.target.value)}
            aria-label={Locale.Settings.OverrideApiKey.Title}
          />
          <button
            type="button"
            className={styles["api-key-eye"]}
            aria-label={showOverrideApiKey ? "隐藏" : "显示"}
            onPointerDown={() => setShowOverrideApiKey(true)}
            onPointerUp={() => setShowOverrideApiKey(false)}
            onPointerLeave={() => setShowOverrideApiKey(false)}
          >
            <EyeIcon />
          </button>
        </div>
      </ListItem>
      <AutoBackupItems />
    </List>
  );
}

/**
 * 定时备份到本地文件夹：选择目录、开关、间隔、保留份数。
 * 不包含任何个人路径或敏感信息，目录由用户通过浏览器选择。
 */
function AutoBackupItems() {
  const [config, setConfig] = useState<AutoBackupConfig | null>(null);
  const [hasDir, setHasDir] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const load = useCallback(async () => {
    const c = await jchatDataManager.getAutoBackupConfig();
    setConfig(c);
    const h = await jchatDataManager.getStoredBackupDirHandle();
    setHasDir(!!h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!jchatDataManager.isBackupToDirectorySupported()) {
    return (
      <ListItem
        title={Locale.Settings.AutoBackup.Title}
        subTitle={Locale.Settings.AutoBackup.Unsupported}
      />
    );
  }

  if (config === null) return null;

  const handleSelectDir = async () => {
    setSelecting(true);
    try {
      const handle = await jchatDataManager.requestBackupDirectory();
      if (handle) {
        setHasDir(true);
        showToast(Locale.Settings.AutoBackup.Saved);
      }
    } finally {
      setSelecting(false);
    }
  };

  const handleEnabledChange = async (enabled: boolean) => {
    const next = { ...config, enabled };
    await jchatDataManager.setAutoBackupConfig(next);
    setConfig(next);
  };

  const handleIntervalChange = async (intervalMinutes: number) => {
    const next = { ...config, intervalMinutes };
    await jchatDataManager.setAutoBackupConfig(next);
    setConfig(next);
  };

  const handleMaxCountChange = async (maxCount: number) => {
    const next = { ...config, maxCount };
    await jchatDataManager.setAutoBackupConfig(next);
    setConfig(next);
  };

  return (
    <ListItem
      title={Locale.Settings.AutoBackup.Title}
      subTitle={Locale.Settings.AutoBackup.SubTitle}
      vertical
    >
      <div className={styles["auto-backup"]}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={styles["mem0-input"]}
            style={{ maxWidth: "160px" }}
            onClick={handleSelectDir}
            disabled={selecting}
          >
            {selecting ? "…" : Locale.Settings.AutoBackup.SelectDirectory}
          </button>
          <span className={styles["list-item-sub-title"]}>
            {hasDir
              ? Locale.Settings.AutoBackup.DirectorySelected
              : Locale.Settings.AutoBackup.DirectoryNotSelected}
          </span>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => handleEnabledChange(e.target.checked)}
            aria-label={Locale.Settings.AutoBackup.Enable}
          />
          <span>{Locale.Settings.AutoBackup.Enable}</span>
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
            flexWrap: "wrap",
          }}
        >
          <span>{Locale.Settings.AutoBackup.Interval}</span>
          <select
            value={config.intervalMinutes}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
            className={styles["mem0-input"]}
            style={{ width: "auto" }}
            aria-label={Locale.Settings.AutoBackup.Interval}
          >
            <option value={60}>{Locale.Settings.AutoBackup.Interval1h}</option>
            <option value={360}>{Locale.Settings.AutoBackup.Interval6h}</option>
            <option value={1440}>
              {Locale.Settings.AutoBackup.Interval24h}
            </option>
          </select>
          <span>{Locale.Settings.AutoBackup.MaxCount}</span>
          <input
            type="number"
            min={1}
            max={50}
            value={config.maxCount}
            onChange={(e) => handleMaxCountChange(Number(e.target.value) || 1)}
            className={styles["mem0-input"]}
            style={{ width: "60px" }}
            aria-label={Locale.Settings.AutoBackup.MaxCount}
          />
        </div>
      </div>
    </ListItem>
  );
}
