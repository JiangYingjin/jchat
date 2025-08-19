import { IconButton } from "./button";
import { DEFAULT_TITLE } from "../store";
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

export const ChatHeader = React.memo(function ChatHeader(props: {
  sessionTitle: string;
  messageCount: number;
  onEditSystemMessageClick: () => void;
  onEditSessionClick: () => void;
  onExportClick: () => void;
  onDeleteSessionClick: () => void;
  onDeleteGroupClick?: () => void; // 新增：删除整个组的回调
  hasGroupId?: boolean; // 新增：是否有 groupId
}) {
  const isMobileScreen = useMobileScreen();
  const chatStore = useChatStore();

  // 处理右键单击标题，刷新会话标题
  const handleTitleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showToast(Locale.Chat.Actions.RefreshTitleToast);
    // 获取当前会话
    const session = chatStore.currentSession();
    await chatStore.generateSessionTitle(true, session);
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

  return (
    <div className="window-header">
      <div className={clsx("window-header-title", styles["chat-body-title"])}>
        <div
          className={clsx(
            "window-header-main-title",
            styles["chat-body-main-title"],
          )}
          onClickCapture={props.onEditSessionClick}
          onContextMenu={handleTitleContextMenu}
        >
          {!props.sessionTitle ? DEFAULT_TITLE : props.sessionTitle}
        </div>
        {!isMobileScreen && (
          <div className="window-header-sub-title">
            {Locale.Chat.SubTitle(props.messageCount)}
          </div>
        )}
      </div>
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
          />
        </div>
        <div className="window-action-button">
          <IconButton
            icon={<DeleteIcon />}
            bordered
            title={
              props.hasGroupId
                ? "左键删除会话，右键删除整个组"
                : Locale.Chat.Actions.Delete
            }
            onClick={props.onDeleteSessionClick}
            onContextMenu={handleDeleteButtonContextMenu}
          />
        </div>
      </div>
    </div>
  );
});
