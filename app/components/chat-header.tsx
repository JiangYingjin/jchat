import { IconButton } from "./button";
import { DEFAULT_TITLE, systemMessageStorage } from "../store";
import EditIcon from "../icons/edit.svg";
import ExportIcon from "../icons/share.svg";
import DeleteIcon from "../icons/clear.svg";
import Locale from "../locales";
import styles from "../styles/chat.module.scss";
import clsx from "clsx";
import { useMobileScreen } from "../utils";
import React from "react";
import { showConfirm } from "./ui-lib";
import { showToast } from "./ui-lib";
import { useChatStore } from "../store";
import {
  shareSessionAsLink,
  type SessionLikeForShare,
} from "../utils/share-client";
import { useShallow } from "zustand/react/shallow";
import { createModuleLogger } from "../utils/logger";
import { useContextMenu } from "./context-menu";
import { SessionContextMenu } from "./session-context-menu";

const chatHeaderLogger = createModuleLogger("CHAT_HEADER");

const debugLog = (category: string, message: string, data?: any) => {
  chatHeaderLogger.debug(category, message, data);
};

// 创建选择器：只订阅当前会话的标题和消息数量
const selectCurrentSessionHeader = (state: any) => {
  const currentSession = state.sessions[state.currentSessionIndex];
  if (!currentSession) return null;
  return {
    title: currentSession.title,
    messageCount: currentSession.messageCount,
  };
};

export const ChatHeader = React.memo(function ChatHeader(props: {
  sessionTitle: string;
  messageCount: number;
  onEditSystemMessageClick?: () => void;
  onEditSessionClick?: () => void;
  onExportClick?: () => void;
  onDeleteSessionClick?: () => void;
  onDeleteGroupClick?: () => void;
  hasGroupId?: boolean;
  /** 分享页只读：仅展示标题，无点击、无右键、无操作按钮 */
  readOnly?: boolean;
}) {
  const isMobileScreen = useMobileScreen();
  const readOnly = props.readOnly ?? false;
  // 只读模式下不订阅 store
  const headerData = useChatStore(
    useShallow(readOnly ? () => null : selectCurrentSessionHeader),
  );

  const chatStore = React.useMemo(() => useChatStore.getState(), []);
  const menu = useContextMenu();

  const currentSession = React.useMemo(() => {
    if (readOnly) return null;
    return chatStore.currentSession();
  }, [chatStore, readOnly]);

  const currentSessionIndex = useChatStore((state) =>
    readOnly ? undefined : state.currentSessionIndex,
  );
  const chatListView = useChatStore((state) => state.chatListView);

  const shouldShowMoveToTop =
    !readOnly &&
    chatListView === "sessions" &&
    currentSessionIndex !== undefined;

  // 添加调试信息
  React.useEffect(() => {
    debugLog("CHAT_HEADER", "标题组件渲染", {
      propTitle: props.sessionTitle,
      storeTitle: headerData?.title,
      propMessageCount: props.messageCount,
      storeMessageCount: headerData?.messageCount,
      timestamp: Date.now(),
    });
  }, [headerData, props.sessionTitle, props.messageCount]);

  // 处理普通会话删除点击（带确认逻辑）
  const handleDeleteSessionClick = async () => {
    // 对于组内会话，直接删除（保持现有逻辑）
    if (props.hasGroupId) {
      props.onDeleteSessionClick?.();
      return;
    }

    // 对于普通会话，根据消息数量决定是否需要确认
    if (props.messageCount >= 10) {
      const confirmed = await showConfirm(
        <div style={{ padding: "8px 16px" }}>
          <div
            style={{
              fontSize: "14px",
              color: "#d32f2f",
              padding: "12px 16px",
              backgroundColor: "#ffebee",
              border: "1px solid #ffcdd2",
              borderRadius: "8px",
              textAlign: "center",
              fontWeight: "500",
            }}
          >
            ⚠️ 即将删除会话 “<strong>{props.sessionTitle}</strong>” （包含{" "}
            <strong>{props.messageCount} 条消息</strong>）
          </div>
        </div>,
      );

      if (confirmed) {
        props.onDeleteSessionClick?.();
      }
    } else {
      // 消息数量 <= 15，直接删除（保持现有行为）
      props.onDeleteSessionClick?.();
    }
  };

  // 处理右键单击删除按钮
  const handleDeleteButtonContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 如果没有 groupId 或者没有删除组的回调，则不执行任何操作
    if (!props.hasGroupId || !props.onDeleteGroupClick) {
      return;
    }

    // 显示确认删除整个组的模态框
    const confirmed = await showConfirm(
      <div style={{ padding: "8px 24px" }}>
        {/* <p
          style={{
            fontSize: "16px",
            fontWeight: "bold",
            marginBottom: "16px",
            textAlign: "center",
          }}
        >
          🗑️ 删除整个组
        </p> */}
        <p style={{ fontSize: "14px", color: "#333", marginBottom: "12px" }}>
          即将删除组 <strong>&ldquo;{props.sessionTitle}&rdquo;</strong>{" "}
          及其所有内容：
        </p>
        <ul
          style={{
            fontSize: "14px",
            color: "#666",
            margin: "8px 0 16px 0",
            paddingLeft: "20px",
            lineHeight: "1.6",
          }}
        >
          <li>组内所有会话（{props.messageCount} 条消息）</li>
          <li>所有聊天记录和对话内容</li>
          <li>组内所有系统提示词</li>
          <li>组内所有未发送输入状态</li>
        </ul>
        <div
          style={{
            fontSize: "14px",
            color: "#d32f2f",
            marginTop: "16px",
            padding: "12px 16px",
            backgroundColor: "#ffebee",
            border: "1px solid #ffcdd2",
            borderRadius: "8px",
            textAlign: "center",
            fontWeight: "500",
          }}
        >
          ⚠️ 此操作将在 8 秒后永久删除所有数据
        </div>
      </div>,
    );

    if (confirmed) {
      props.onDeleteGroupClick();
    }
  };

  // 处理导出按钮右键：分享为链接并发送到通知服务（等同导出面板中"分享为链接"的右键单击）
  const handleExportButtonContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const session = chatStore.currentSession();
    if (!session) return;

    try {
      const systemMessageData = await systemMessageStorage.get(session.id);
      const data = await shareSessionAsLink(
        session as unknown as SessionLikeForShare & Record<string, unknown>,
        systemMessageData,
      );
      if (data?.link) {
        showToast(Locale.Export.LinkCopied);
        fetch("https://dj.jyj.cx/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: data.link,
          }),
        }).catch(() => {});
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : Locale.Export.ShareFailed);
    }
  };

  return (
    <div className="window-header">
      <div className={clsx("window-header-title", styles["chat-body-title"])}>
        <div
          className={clsx(
            "window-header-main-title",
            styles["chat-body-main-title"],
          )}
          {...(readOnly
            ? {}
            : {
                onClickCapture: props.onEditSessionClick,
                onContextMenu: menu.openAtEvent,
              })}
        >
          {!props.sessionTitle ? DEFAULT_TITLE : props.sessionTitle}
        </div>
        {!isMobileScreen && (
          <div className="window-header-sub-title">
            {Locale.Chat.SubTitle(props.messageCount)}
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              icon={<EditIcon />}
              bordered
              title="编辑上下文"
              onClick={props.onEditSystemMessageClick}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<ExportIcon />}
              bordered
              title={Locale.Chat.Actions.Export}
              onClick={props.onExportClick}
              onContextMenu={handleExportButtonContextMenu}
            />
          </div>
          <div className="window-action-button">
            {props.messageCount < 30 && (
              <IconButton
                icon={<DeleteIcon />}
                bordered
                title={
                  props.hasGroupId
                    ? "左键删除会话，右键删除整个组"
                    : Locale.Chat.Actions.Delete
                }
                onClick={handleDeleteSessionClick}
                onContextMenu={handleDeleteButtonContextMenu}
              />
            )}
          </div>
        </div>
      )}

      {!readOnly && menu.isOpen && currentSession && (
        <SessionContextMenu
          sessionId={currentSession.id}
          session={currentSession}
          showMoveToTop={shouldShowMoveToTop}
          sessionIndex={shouldShowMoveToTop ? currentSessionIndex : undefined}
          enableInlineEdit={false}
          onEditSession={props.onEditSessionClick}
          menu={menu}
        />
      )}
    </div>
  );
});
