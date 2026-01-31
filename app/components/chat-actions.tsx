import React, { useState, useEffect } from "react";
import { useChatStore } from "../store";
import { useMobileScreen } from "../utils";
import { ChatControllerPool } from "../client/controller";
import Locale from "../locales";
import { ChatAction } from "./chat-action";
import { SearchSelector } from "./ui-lib";
import LoadingButtonIcon from "../icons/loading.svg";
import ImageIcon from "../icons/image.svg";
import RobotIcon from "../icons/robot.svg";
import EditIcon from "../icons/edit.svg";
import StopIcon from "../icons/pause.svg";
import CameraIcon from "../icons/camera.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import BrainIcon from "../icons/brain.svg";
import styles from "../styles/chat.module.scss";

export function ChatActions(props: {
  uploadImage: () => Promise<void>;
  capturePhoto: () => Promise<void>;
  uploading: boolean;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  // stop all responses
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // switch model
  const currentModel = session.model;
  const models = chatStore.models;

  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);

  const isMobileScreen = useMobileScreen();

  useEffect(() => {
    // 所有模型都支持视觉功能
    setShowUploadImage(isMobileScreen);
  }, [isMobileScreen]);

  // Alt+Z：切换当前会话的用户记忆（仅普通会话且已配置 mem0_user_id 时有效）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "z" || e.key === "Z")) {
        const state = useChatStore.getState();
        const sess = state.currentSession();
        if (sess.groupId || !state.mem0_user_id?.trim()) return;
        e.preventDefault();
        state.updateSession(sess, (s) => {
          s.useMemory = !(s.useMemory ?? false);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Alt+L：切换长输入模式（与「长输入模式」按钮一致）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "l" || e.key === "L")) {
        const state = useChatStore.getState();
        const sess = state.currentSession();
        e.preventDefault();
        if (sess.groupId) {
          const { groups, groupSessions, currentGroupIndex } = state;
          const currentGroup = groups[currentGroupIndex];
          if (currentGroup) {
            const newMode = !(sess.longInputMode ?? false);
            currentGroup.sessionIds.forEach((sid) => {
              const gs = groupSessions[sid];
              if (gs) {
                state.updateGroupSession(gs, (s) => {
                  s.longInputMode = newMode;
                });
              }
            });
          }
        } else {
          state.updateSession(sess, (s) => {
            s.longInputMode = !(s.longInputMode ?? false);
          });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles["chat-input-actions"]}>
      <>
        {showUploadImage && (
          <ChatAction
            onClick={props.capturePhoto}
            text="拍照上传"
            icon={props.uploading ? <LoadingButtonIcon /> : <CameraIcon />}
            alwaysFullWidth={false}
          />
        )}
        {showUploadImage && (
          <ChatAction
            onClick={props.uploadImage}
            text={Locale.Chat.InputActions.UploadImage}
            icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
            alwaysFullWidth={false}
          />
        )}

        <ChatAction
          onClick={() => setShowModelSelector(true)}
          text={currentModel}
          icon={<RobotIcon />}
          alwaysFullWidth={true}
        />
        {!session.groupId &&
          !!chatStore.mem0_user_id?.trim() &&
          !isMobileScreen && (
            <ChatAction
              onClick={() => {
                chatStore.updateSession(session, (s) => {
                  s.useMemory = !(s.useMemory ?? false);
                });
              }}
              text={Locale.Chat.InputActions.UseMemory}
              icon={<BrainIcon />}
              alwaysFullWidth={false}
              style={{
                backgroundColor: session.useMemory
                  ? "var(--primary-light, #e6f0fa)"
                  : undefined,
                color: session.useMemory
                  ? "var(--primary, #2196f3)"
                  : undefined,
                opacity: session.useMemory ? 1 : 0.7,
                border: session.useMemory
                  ? "1.5px solid var(--primary)"
                  : undefined,
              }}
            />
          )}
        {!isMobileScreen && (
          <ChatAction
            onClick={() => {
              if (session.groupId) {
                // 获取当前组所有会话
                const state = useChatStore.getState();
                const { groups, groupSessions, currentGroupIndex } = state;
                const currentGroup = groups[currentGroupIndex];
                if (currentGroup) {
                  const newMode = !(session.longInputMode ?? false);
                  currentGroup.sessionIds.forEach((sid) => {
                    const groupSession = groupSessions[sid];
                    if (groupSession) {
                      chatStore.updateGroupSession(groupSession, (sess) => {
                        sess.longInputMode = newMode;
                      });
                    }
                  });
                }
              } else {
                chatStore.updateSession(session, (s) => {
                  s.longInputMode = !s.longInputMode;
                });
              }
            }}
            text={"长输入模式"}
            icon={<EditIcon />}
            alwaysFullWidth={false}
            style={{
              backgroundColor: session.longInputMode
                ? "var(--primary-light, #e6f0fa)"
                : undefined,
              color: session.longInputMode
                ? "var(--primary, #2196f3)"
                : undefined,
              opacity: session.longInputMode ? 1 : 0.7,
              border: session.longInputMode
                ? "1.5px solid var(--primary)"
                : undefined,
            }}
          />
        )}
        {session.groupId && !isMobileScreen && (
          <ChatAction
            onClick={() => {
              if (session.groupId) {
                // 获取当前组所有会话
                const state = useChatStore.getState();
                const { groups, groupSessions, currentGroupIndex } = state;
                const currentGroup = groups[currentGroupIndex];
                if (currentGroup) {
                  const newMode = !(session.ignoreSystemPrompt ?? false);
                  currentGroup.sessionIds.forEach((sid) => {
                    const groupSession = groupSessions[sid];
                    if (groupSession) {
                      chatStore.updateGroupSession(groupSession, (sess) => {
                        sess.ignoreSystemPrompt = newMode;
                      });
                    }
                  });
                }
              } else {
                chatStore.updateSession(session, (s) => {
                  s.ignoreSystemPrompt = !(s.ignoreSystemPrompt ?? false);
                });
              }
            }}
            text={"忽略系统提示词"}
            icon={<EyeOffIcon />}
            alwaysFullWidth={false}
            style={{
              backgroundColor: session.ignoreSystemPrompt
                ? "var(--primary-light, #e6f0fa)"
                : undefined,
              color: session.ignoreSystemPrompt
                ? "var(--primary, #2196f3)"
                : undefined,
              opacity: session.ignoreSystemPrompt ? 1 : 0.7,
              border: session.ignoreSystemPrompt
                ? "1.5px solid var(--primary)"
                : undefined,
            }}
          />
        )}

        {showModelSelector && (
          <SearchSelector
            defaultSelectedValue={currentModel}
            items={models.map((m) => ({
              title: `${m}`,
              value: m,
            }))}
            onClose={() => setShowModelSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              if (session.groupId) {
                // 获取当前组所有会话
                const state = useChatStore.getState();
                const { groups, groupSessions, currentGroupIndex } = state;
                const currentGroup = groups[currentGroupIndex];
                if (currentGroup) {
                  currentGroup.sessionIds.forEach((sid) => {
                    const groupSession = groupSessions[sid];
                    if (groupSession) {
                      chatStore.updateGroupSession(groupSession, (sess) => {
                        sess.model = s[0] as string;
                        sess.isModelManuallySelected = true;
                      });
                    }
                  });
                }
              } else {
                chatStore.updateSession(session, (session) => {
                  session.model = s[0] as string;
                  session.isModelManuallySelected = true;
                });
              }
            }}
          />
        )}

        {couldStop && (
          <ChatAction
            onClick={stopAll}
            text={Locale.Chat.InputActions.Stop}
            icon={<StopIcon />}
            alwaysFullWidth={false}
          />
        )}
      </>
      <div className={styles["chat-input-actions-end"]}></div>
    </div>
  );
}
