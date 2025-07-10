import { useState, useEffect, useMemo } from "react";

import styles from "./settings.module.scss";

import ResetIcon from "../icons/reload.svg";
import AddIcon from "../icons/add.svg";
import CloseIcon from "../icons/close.svg";
import CopyIcon from "../icons/copy.svg";
import ClearIcon from "../icons/clear.svg";
import LoadingIcon from "../icons/three-dots.svg";
import EditIcon from "../icons/edit.svg";
import FireIcon from "../icons/fire.svg";
import EyeIcon from "../icons/eye.svg";
import DownloadIcon from "../icons/download.svg";
import UploadIcon from "../icons/upload.svg";
import ConfigIcon from "../icons/config.svg";
import ConfirmIcon from "../icons/confirm.svg";

import ConnectionIcon from "../icons/connection.svg";
import {
  Input,
  List,
  ListItem,
  Modal,
  PasswordInput,
  Popover,
  Select,
  showConfirm,
  showToast,
} from "./ui-lib";
import { IconButton } from "./button";
import { useChatStore } from "../store";

import Locale from "../locales";
import { copyToClipboard } from "../utils";
import { OPENAI_BASE_URL, Path } from "../constant";

import { ErrorBoundary } from "./error";
import { InputRange } from "./input-range";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import { checkAndHandleAuth } from "../utils/auth";

function LocalDataItems() {
  const chatStore = useChatStore();
  const [databaseStats, setDatabaseStats] = useState({
    sessions: 0,
    messages: 0,
    systemMessages: 0,
    chatInputs: 0,
  });

  // 异步加载真实的数据库统计信息
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

  const stateOverview = useMemo(() => {
    // 使用真实的数据库统计，同时保持向后兼容
    const sessions = chatStore.sessions;
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

export function Settings() {
  const navigate = useNavigate();

  // 打开 settings 页面时检查权限
  useEffect(() => {
    checkAndHandleAuth(navigate);
  }, [navigate]);

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
