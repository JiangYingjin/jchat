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
        {!isMobileScreen && (
          <ChatAction
            onClick={() => {
              chatStore.updateSession(session, (s) => {
                s.longInputMode = !s.longInputMode;
              });
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
              chatStore.updateSession(session, (session) => {
                session.model = s[0] as string;
                // 标记用户手动选择了模型
                session.isModelManuallySelected = true;
              });
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
