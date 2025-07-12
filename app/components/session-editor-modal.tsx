import React, { useState } from "react";
import { useChatStore, type ChatSession } from "../store";
import { showToast } from "./ui-lib";
import { IconButton } from "./button";
import { List, ListItem, Modal } from "./ui-lib";
import { MessageListEditor } from "./message-list-editor";
import Locale from "../locales";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import ReloadIcon from "../icons/reload.svg";

export function SessionEditorModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());

  // 判断是否为组内会话
  const isGroupSession = session.groupId !== null;

  // 根据会话类型选择更新方法
  const updateSession = (updater: (session: ChatSession) => void) => {
    if (isGroupSession) {
      chatStore.updateGroupSession(session, updater);
    } else {
      chatStore.updateTargetSession(session, updater);
    }
  };

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => {
              props.onClose();
            }}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              updateSession((session) => (session.messages = messages));
              props.onClose();
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.title}
              onInput={(e) =>
                updateSession(
                  (session) => (session.title = e.currentTarget.value),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  updateSession(
                    (session) => (session.title = e.currentTarget.value),
                  );
                  props.onClose();
                }
              }}
            ></input>
            <IconButton
              icon={<ReloadIcon />}
              bordered
              title={Locale.Chat.Actions.RefreshTitle}
              onClick={() => {
                showToast(Locale.Chat.Actions.RefreshToast);
                chatStore.summarizeSession(true, session);
              }}
            />
          </ListItem>
        </List>
        <MessageListEditor
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
          onModalClose={props.onClose}
        />
      </Modal>
    </div>
  );
}
