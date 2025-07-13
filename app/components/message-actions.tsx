import React from "react";
import { ChatMessage } from "../store";
import { copyToClipboard, getMessageTextContent } from "../utils";
import { ChatAction, DoubleClickChatAction } from "./chat-action";
import { IconButton } from "./button";
import styles from "../styles/chat.module.scss";

import CopyIcon from "../icons/copy.svg";
import DeleteIcon from "../icons/clear.svg";
import ResetIcon from "../icons/reload.svg";
import StopIcon from "../icons/pause.svg";
import BranchIcon from "../icons/branch.svg";
import GroupIcon from "../icons/group.svg";

import Locale from "../locales";

export function MessageActions(props: {
  message: ChatMessage;
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  onBatchApply: (message: ChatMessage) => void; // 新增：批量应用回调
  index: number;
  showBranch?: boolean; // 新增：控制是否显示分支按钮
  showBatchApply?: boolean; // 新增：控制是否显示批量应用按钮
}) {
  const {
    message,
    onResend,
    onDelete,
    onUserStop,
    onBranch,
    onBatchApply,
    index,
    showBranch = true,
    showBatchApply = true,
  } = props;

  return (
    <div className={styles["chat-input-actions"]}>
      {message.streaming ? (
        <ChatAction
          text={Locale.Chat.Actions.Stop}
          icon={<StopIcon />}
          onClick={() => onUserStop(message.id ?? index.toString())}
          alwaysFullWidth={false}
        />
      ) : (
        <>
          <DoubleClickChatAction
            text={Locale.Chat.Actions.Retry}
            icon={<ResetIcon />}
            onClick={() => onResend(message)}
            alwaysFullWidth={false}
          />
          <ChatAction
            text={Locale.Chat.Actions.Copy}
            icon={<CopyIcon />}
            onClick={() => copyToClipboard(getMessageTextContent(message))}
            alwaysFullWidth={false}
          />
          <ChatAction
            text={Locale.Chat.Actions.Delete}
            icon={<DeleteIcon />}
            onClick={() => onDelete(message.id ?? index.toString())}
            alwaysFullWidth={false}
          />
          {showBranch && (
            <ChatAction
              text={Locale.Chat.Actions.Branch}
              icon={<BranchIcon />}
              onClick={() => onBranch(message, index)}
              alwaysFullWidth={false}
            />
          )}
          {showBatchApply && (
            <DoubleClickChatAction
              text={Locale.Chat.Actions.BatchApply}
              confirmText={Locale.Chat.Actions.BatchApplyConfirm}
              icon={<GroupIcon />}
              onClick={() => onBatchApply(message)}
              alwaysFullWidth={false}
            />
          )}
        </>
      )}
    </div>
  );
}
