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
import { jchatStorage } from "../utils/store";

export function SessionEditor(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [localTitle, setLocalTitle] = useState(session.title);

  // 判断是否为组内会话
  const isGroupSession = session.groupId !== null;

  // 更新会话标题
  const updateSessionTitle = (title: string) => {
    if (isGroupSession) {
      chatStore.updateGroupSession(session, (session) => {
        session.title = title;
      });
    } else {
      chatStore.updateSession(session, (session) => {
        session.title = title;
      });
    }
  };

  // 保存标题并广播更新（异步非阻塞）
  const saveTitleAndBroadcast = async () => {
    const currentChatStore = useChatStore.getState();
    const currentSession = currentChatStore.currentSession();

    // 立即更新标题（同步，用户立即看到效果）
    updateSessionTitle(localTitle);

    // 异步保存和广播（不阻塞UI）
    (async () => {
      try {
        // 保存会话
        await currentChatStore.saveSessionMessages(currentSession);

        // 等待存储写入完成
        await new Promise((resolve) => setTimeout(resolve, 100));

        // 发送广播通知其他标签页
        if (
          typeof window !== "undefined" &&
          (window as any).__jchat_broadcast_channel
        ) {
          const message = {
            type: "STATE_UPDATE_AVAILABLE",
            payload: {
              lastUpdate: Date.now(),
              changeType: "sessionUpdate",
              sessionId: currentSession.id,
            },
          };
          (window as any).__jchat_broadcast_channel.postMessage(message);
        }
      } catch (error) {
        console.error("保存会话标题失败:", error);
        // 可以在这里添加错误提示
      }
    })();
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
              saveTitleAndBroadcast();
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
              value={localTitle}
              onInput={(e) => setLocalTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTitleAndBroadcast();
                  props.onClose();
                }
              }}
            ></input>
            <IconButton
              icon={<ReloadIcon />}
              bordered
              title={Locale.Chat.Actions.RefreshTitle}
              onClick={async () => {
                showToast(Locale.Chat.Actions.RefreshTitleToast);
                await chatStore.generateSessionTitle(true, session);
                setLocalTitle(session.title);
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
