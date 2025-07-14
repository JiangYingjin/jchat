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
import MergeCopyIcon from "../icons/merge-copy.svg"; // 引入新的合并复制图标

import Locale from "../locales";

export function MessageActions(props: {
  message: ChatMessage;
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  onBatchApply: (message: ChatMessage) => void; // 新增：批量应用回调
  onBatchDelete: (message: ChatMessage) => void; // 新增：批量删除回调
  onMergeCopy: (message: ChatMessage) => void; // 新增：合并复制回调
  index: number;
  showBranch?: boolean; // 新增：控制是否显示分支按钮
  showBatchApply?: boolean; // 新增：控制是否显示批量应用按钮
  showBatchDelete?: boolean; // 新增：控制是否显示批量删除按钮
  showDelete?: boolean; // 新增：控制是否显示单个删除按钮
  showMergeCopy?: boolean; // 新增：控制是否显示合并复制按钮
}) {
  const {
    message,
    onResend,
    onDelete,
    onUserStop,
    onBranch,
    onBatchApply,
    onBatchDelete,
    onMergeCopy,
    index,
    showBranch = true,
    showBatchApply = true,
    showBatchDelete = true,
    showDelete = true,
    showMergeCopy = false,
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
          {/* 合并复制按钮，仅组内会话显示，紧挨复制按钮 */}
          {showMergeCopy && (
            <ChatAction
              text={"合并复制"}
              icon={<MergeCopyIcon />} // 使用新的图标
              onClick={() => onMergeCopy(message)}
              alwaysFullWidth={false}
            />
          )}
          {showDelete && (
            <ChatAction
              text={Locale.Chat.Actions.Delete}
              icon={<DeleteIcon />}
              onClick={() => onDelete(message.id ?? index.toString())}
              alwaysFullWidth={false}
            />
          )}
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
              icon={<GroupIcon />}
              onClick={() => onBatchApply(message)}
              alwaysFullWidth={false}
            />
          )}
          {showBatchDelete && (
            <DoubleClickChatAction
              text={Locale.Chat.Actions.BatchDelete}
              icon={<DeleteIcon />}
              onClick={() => onBatchDelete(message)}
              alwaysFullWidth={false}
            />
          )}
        </>
      )}
    </div>
  );
}
