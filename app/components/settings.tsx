// --- 1. Imports ---
// Grouped by type for clarity and better organization.

// React and Hooks
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

// State Management
import { useChatStore } from "../store";

// UI Components
import { List, ListItem, showToast } from "./ui-lib";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";

// Icons and Styles
import styles from "./settings.module.scss";
import CloseIcon from "../icons/close.svg";
import DownloadIcon from "../icons/download.svg";
import UploadIcon from "../icons/upload.svg";

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
  const navigate = useNavigate();

  // Effect for checking authentication when the component mounts.
  useEffect(() => {
    checkAndHandleAuth(navigate);
  }, [navigate]);

  // Effect for handling the 'Escape' key to close the settings page.
  useEffect(() => {
    const keydownEvent = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        navigate(Path.Home);
      }
    };
    document.addEventListener("keydown", keydownEvent);
    return () => {
      document.removeEventListener("keydown", keydownEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              onClick={() => navigate(Path.Home)}
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
  const [databaseStats, setDatabaseStats] = useState({
    sessions: 0,
    messages: 0,
    systemMessages: 0,
    chatInputs: 0,
  });

  // Asynchronously load real database statistics on component mount.
  useEffect(() => {
    const loadDatabaseStats = async () => {
      try {
        const { jchatDataManager } = await import("../utils/data-manager");
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
    try {
      const { jchatDataManager } = await import("../utils/data-manager");
      await jchatDataManager.exportData();
    } catch (error) {
      console.error("导出失败:", error);
      showToast("导出失败，请检查控制台");
    }
  };

  const handleImport = async () => {
    try {
      const { jchatDataManager } = await import("../utils/data-manager");
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
        <div style={{ display: "flex" }}>
          <IconButton
            aria={Locale.Settings.LocalData.LocalState + Locale.UI.Export}
            icon={<UploadIcon />}
            text={Locale.UI.Export}
            onClick={handleExport}
          />
          <IconButton
            aria={Locale.Settings.LocalData.LocalState + Locale.UI.Import}
            icon={<DownloadIcon />}
            text={Locale.UI.Import}
            onClick={handleImport}
          />
        </div>
      </ListItem>
    </List>
  );
}
