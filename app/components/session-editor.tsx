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
  const [messages, setMessages] = useState(session.messages.slice());
  const [localTitle, setLocalTitle] = useState(session.title); // 本地标题状态

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

  // 保存会话并发送广播
  const saveSessionAndBroadcast = async (sessionToSave?: ChatSession) => {
    // 使用传入的会话或获取最新的会话状态
    const currentChatStore = useChatStore.getState();
    const currentSession = sessionToSave || currentChatStore.currentSession();

    console.log("🔥 [SESSION_EDIT] 保存会话前检查", {
      sessionId: currentSession.id,
      sessionTitle: currentSession.title,
      localTitle: localTitle,
      titleMatch: currentSession.title === localTitle,
    });

    // 如果标题不匹配，说明 updateSession 没有生效，需要重新更新
    if (currentSession.title !== localTitle) {
      console.warn("🔥 [SESSION_EDIT] 标题不匹配，重新更新", {
        currentTitle: currentSession.title,
        localTitle: localTitle,
      });

      // 重新更新标题
      if (isGroupSession) {
        currentChatStore.updateGroupSession(currentSession, (session) => {
          session.title = localTitle;
        });
      } else {
        currentChatStore.updateSession(currentSession, (session) => {
          session.title = localTitle;
        });
      }

      // 重新获取更新后的会话
      const updatedSession = currentChatStore.currentSession();
      console.log("🔥 [SESSION_EDIT] 重新更新后检查", {
        sessionId: updatedSession.id,
        sessionTitle: updatedSession.title,
        localTitle: localTitle,
        titleMatch: updatedSession.title === localTitle,
      });
    }

    // 如果传入了会话对象，先更新 store 再保存
    if (sessionToSave) {
      if (currentSession.groupId) {
        currentChatStore.updateGroupSession(currentSession, (session) => {
          session.title = sessionToSave.title;
          session.messages = sessionToSave.messages;
        });
      } else {
        currentChatStore.updateSession(currentSession, (session) => {
          session.title = sessionToSave.title;
          session.messages = sessionToSave.messages;
        });
      }
    }

    await currentChatStore.saveSessionMessages(currentSession);

    // 根据会话类型更新状态
    if (currentSession.groupId) {
      currentChatStore.updateGroupSession(currentSession, (session) => {});
    } else {
      currentChatStore.updateSession(currentSession, (session) => {});
    }

    // 等待存储写入完成，确保其他标签页能读取到最新数据
    console.log("🔥 [SESSION_EDIT] 等待存储写入完成...");
    await new Promise((resolve) => setTimeout(resolve, 100)); // 等待500ms确保存储写入完成

    // 验证存储中的数据是否已更新
    try {
      const storedData = await jchatStorage.getItem("chats");
      const parsedData = storedData?.state || storedData;
      const firstSessionTitle = parsedData?.sessions?.[0]?.title || "无";
      console.log("🔥 [SESSION_EDIT] 存储验证", {
        storedTitle: firstSessionTitle,
        expectedTitle: localTitle,
        titleMatch: firstSessionTitle === localTitle,
      });
    } catch (error) {
      console.warn("🔥 [SESSION_EDIT] 存储验证失败", error);
    }

    // 发送广播通知其他标签页
    console.log("🔥 [SESSION_EDIT] 会话编辑确认，广播更新", {
      sessionId: currentSession.id,
      messageCount: currentSession.messageCount,
      timestamp: Date.now(),
    });

    if (
      typeof window !== "undefined" &&
      (window as any).__jchat_broadcast_channel
    ) {
      const message = {
        type: "STATE_UPDATE_AVAILABLE",
        payload: {
          lastUpdate: Date.now(),
          changeType: "messageUpdate", // 消息更新类型
          sessionId: currentSession.id,
        },
      };

      console.log("🔥 [SESSION_EDIT] 发送会话编辑广播", {
        message,
        broadcastChannelExists: !!(window as any).__jchat_broadcast_channel,
      });

      (window as any).__jchat_broadcast_channel.postMessage(message);
    } else {
      console.warn("🔥 [SESSION_EDIT] Broadcast Channel 不存在，无法发送广播");
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
            onClick={async () => {
              console.log("🔥 [SESSION_EDIT] 确认按钮点击", {
                localTitle: localTitle,
                originalTitle: session.title,
                titleChanged: localTitle !== session.title,
              });

              // 先创建包含新标题的会话对象用于广播
              const updatedSession = {
                ...session,
                title: localTitle,
                messages: messages,
              };

              // 发送广播并更新 store（避免时序问题）
              await saveSessionAndBroadcast(updatedSession);

              console.log("🔥 [SESSION_EDIT] 保存完成后检查", {
                currentTitle: useChatStore.getState().currentSession().title,
                localTitle: localTitle,
                titleMatch:
                  useChatStore.getState().currentSession().title === localTitle,
              });

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
              onKeyDown={async (e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  updateSession((session) => (session.title = localTitle));

                  // 保存会话并发送广播
                  await saveSessionAndBroadcast();

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
                // 更新本地标题状态
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
