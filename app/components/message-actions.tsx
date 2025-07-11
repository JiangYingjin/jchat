import React from "react";
import { ChatMessage } from "../store";
import { copyToClipboard, getMessageTextContent } from "../utils";
import { ChatAction, DoubleClickChatAction } from "./chat-action";
import { IconButton } from "./button";
import styles from "./chat.module.scss";

import CopyIcon from "../icons/copy.svg";
import DeleteIcon from "../icons/clear.svg";
import ResetIcon from "../icons/reload.svg";
import StopIcon from "../icons/pause.svg";
import BranchIcon from "../icons/branch.svg";

import Locale from "../locales";

export function MessageActions(props: {
  message: ChatMessage;
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  onBranch: (message: ChatMessage, index: number) => void;
  index: number;
}) {
  const { message, onResend, onDelete, onUserStop, onBranch, index } = props;

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
          <ChatAction
            text={Locale.Chat.Actions.Branch}
            icon={<BranchIcon />}
            onClick={() => onBranch(message, index)}
            alwaysFullWidth={false}
          />
        </>
      )}
    </div>
  );
}
