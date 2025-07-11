import { IconButton } from "./button";
import { DEFAULT_TITLE } from "../store";
import EditIcon from "../icons/edit.svg";
import ExportIcon from "../icons/share.svg";
import DeleteIcon from "../icons/clear.svg";
import Locale from "../locales";
import styles from "./chat.module.scss";
import clsx from "clsx";
import { useMobileScreen } from "../utils";
import React from "react";

export function ChatHeader(props: {
  sessionTitle: string;
  messageCount: number;
  onEditSystemMessageClick: () => void;
  onEditSessionClick: () => void;
  onExportClick: () => void;
  onDeleteSessionClick: () => void;
}) {
  const isMobileScreen = useMobileScreen();

  return (
    <div className="window-header">
      <div className={clsx("window-header-title", styles["chat-body-title"])}>
        <div
          className={clsx(
            "window-header-main-title",
            styles["chat-body-main-title"],
          )}
          onClickCapture={props.onEditSessionClick}
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
            title={Locale.Chat.Actions.Delete}
            onClick={props.onDeleteSessionClick}
          />
        </div>
      </div>
    </div>
  );
}
