import React, { useState } from "react";
import { useChatStore, type ChatSession } from "../store";
import { showToast } from "./ui-lib";
import { IconButton } from "./button";
import { List, ListItem, Modal } from "./ui-lib";
import Locale from "../locales";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import ReloadIcon from "../icons/reload.svg";
import { aggregateSessionMetrics } from "../utils/session";
import { formatCost, formatTime, formatTps } from "../utils/metrics";

export function SessionEditor(props: { onClose: () => void }) {
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
      chatStore.updateSession(session, updater);
    }
  };

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditSession.Title}
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
            title={Locale.Chat.EditSession.SessionTitle.Title}
            subTitle={Locale.Chat.EditSession.SessionTitle.SubTitle}
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
                showToast(Locale.Chat.Actions.RefreshTitleToast);
                chatStore.generateSessionTitle(true, session);
              }}
            />
          </ListItem>

          {(() => {
            const metrics = aggregateSessionMetrics(session, {
              includeStreaming: false,
            });

            const costStr =
              metrics.totalCost > 0 ? `￥${formatCost(metrics.totalCost)}` : "";

            const inTokens = metrics.totalPromptTokens || 0;
            const outTokens = metrics.totalCompletionTokens || 0;
            const tokensStr =
              inTokens + outTokens > 0 ? `${inTokens}/${outTokens}` : "";

            const ttftStr = (() => {
              return typeof metrics.avgTtft === "number"
                ? `${formatTime(metrics.avgTtft)}s`
                : "";
            })();

            const totalStr = (() => {
              return typeof metrics.avgTotalTime === "number"
                ? `${formatTime(metrics.avgTotalTime)}s`
                : "";
            })();

            const tpsStr = (() => {
              return typeof metrics.weightedTps === "number"
                ? formatTps(metrics.weightedTps)
                : "";
            })();

            const parts: string[] = [];
            if (costStr) parts.push(costStr);
            if (tokensStr) parts.push(tokensStr);

            const timePieces: string[] = [];
            if (ttftStr) timePieces.push(ttftStr);
            if (totalStr) timePieces.push(totalStr);
            let timePart = timePieces.join("/");
            if (timePart) {
              timePart = tpsStr ? `${timePart} (${tpsStr})` : timePart;
              parts.push(timePart);
            } else if (tpsStr) {
              parts.push(`(${tpsStr})`);
            }

            if (parts.length === 0) return null;

            return (
              <ListItem title="统计数据">
                <div>{parts.join(" · ")}</div>
              </ListItem>
            );
          })()}
        </List>
      </Modal>
    </div>
  );
}
