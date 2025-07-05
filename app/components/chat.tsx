import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
  RefObject,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";

import BrainIcon from "../icons/brain.svg";
import ExportIcon from "../icons/share.svg";
import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import ResetIcon from "../icons/reload.svg";
import DeleteIcon from "../icons/clear.svg";
import EditIcon from "../icons/edit.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import EnablePluginIcon from "../icons/plugin_enable.svg";
import DisablePluginIcon from "../icons/plugin_disable.svg";
import UploadIcon from "../icons/upload.svg";
import ImageIcon from "../icons/image.svg";
import CameraIcon from "../icons/camera.svg";

import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";
import CheckmarkIcon from "../icons/checkmark.svg";

import ReloadIcon from "../icons/reload.svg";

import EnableThinkingIcon from "../icons/thinking_enable.svg";
import DisableThinkingIcon from "../icons/thinking_disable.svg";
import {
  ChatMessage,
  useChatStore,
  createMessage,
  useAccessStore,
  useAppConfig,
  DEFAULT_TOPIC,
  ModelType,
  usePluginStore,
  systemMessageStorage,
  chatInputStorage,
} from "../store";

import {
  copyToClipboard,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
  isVisionModel,
  showPlugins,
  safeLocalStorage,
  isSupportRAGModel,
  isFunctionCallModel,
  isClaudeThinkingModel,
} from "../utils";

import { uploadImage as uploadImageRemote } from "@/app/utils/chat";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";

import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  SearchSelector,
  Selector,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  ModelProvider,
  Path,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} from "../constant";

import { useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
import { useAllModels } from "../utils/hooks";
import { MultimodalContent } from "../client/api";

import { ClientApi } from "../client/api";

import { isEmpty } from "lodash-es";
import { getModelProvider } from "../utils/model";
import clsx from "clsx";

import { FileInfo } from "../client/platforms/utils";
import { ThinkingContent } from "./thinking-content";
import { MessageContentEditPanel } from "./MessageContentEditPanel";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

export function SessionConfigModel(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div className="modal-mask">
      <Modal title={Locale.Context.Edit} onClose={() => props.onClose()}>
        <div>Mask configuration is no longer available.</div>
      </Modal>
    </div>
  );
}

function PromptToast(props: {
  showToast?: boolean;
  showModal?: boolean;
  setShowModal: (_: boolean) => void;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const context = session.mask.context;

  return (
    <div className={styles["prompt-toast"]} key="prompt-toast">
      {props.showToast && context.length > 0 && (
        <div
          className={clsx(styles["prompt-toast-inner"], "clickable")}
          role="button"
          onClick={() => props.setShowModal(true)}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
        </div>
      )}
      {props.showModal && (
        <SessionConfigModel onClose={() => props.setShowModal(false)} />
      )}
    </div>
  );
}

function useSubmitHandler() {
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;

    // Shift + Enter 用于换行，不发送
    if (e.shiftKey) return false;

    // Enter 或 Ctrl + Enter 发送
    return !e.altKey && !e.metaKey;
  };

  return {
    shouldSubmit,
  };
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

function ChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean; // 新增参数，控制是否总是 full 宽度
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useEffect(() => {
    if (props.alwaysFullWidth) {
      updateWidth();
    }
  }, [props.text, props.icon, props.alwaysFullWidth]);

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={() => {
        if (props.loding) return;
        props.onClick();
        iconRef ? setTimeout(updateWidth, 1) : undefined;
      }}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && props.text}
      </div>
      {props.innerNode}
    </div>
  );
}

// 新增：双击确认的 ChatAction 组件
function DoubleClickChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean;
  confirmText?: string; // 确认时的文本
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });
  const [clickCount, setClickCount] = useState(0);
  const [isConfirmed, setIsConfirmed] = useState(false);

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
          // 当确认时改变样式
          ...(isConfirmed
            ? {
                backgroundColor: "var(--primary-light, #e6f0fa)",
                color: "var(--primary, #2196f3)",
                border: "1.5px solid var(--primary)",
              }
            : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useEffect(() => {
    if (props.alwaysFullWidth) {
      updateWidth();
    }
  }, [props.text, props.icon, props.alwaysFullWidth]);

  const handleClick = () => {
    if (props.loding) return;

    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);

    if (newClickCount === 1) {
      // 第一次点击，显示确认状态
      setIsConfirmed(true);
      // 3秒后自动重置
      setTimeout(() => {
        setClickCount(0);
        setIsConfirmed(false);
      }, 3000);
    } else if (newClickCount === 2) {
      // 第二次点击，执行操作
      props.onClick();
      setClickCount(0);
      setIsConfirmed(false);
    }
  };

  const handleMouseLeave = () => {
    // 鼠标移出时重置状态
    setClickCount(0);
    setIsConfirmed(false);
  };

  const displayText = isConfirmed ? props.confirmText || "重试" : props.text;

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={handleClick}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onMouseLeave={handleMouseLeave}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && displayText}
      </div>
      {props.innerNode}
    </div>
  );
}

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  // for auto-scroll

  const [autoScroll, setAutoScroll] = useState(true);
  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

export function ChatActions(props: {
  uploadImage: () => Promise<void>;
  capturePhoto: () => Promise<void>;
  setAttachImages: (images: string[]) => void;
  uploadFile: () => Promise<void>;
  setAttachFiles: (files: FileInfo[]) => void;
  setUploading: (uploading: boolean) => void;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setUserInput: (input: string) => void;
  setShowChatSidePanel: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const config = useAppConfig();
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const pluginStore = usePluginStore();
  const session = chatStore.currentSession();

  // switch thinking mode
  const claudeThinking = chatStore.currentSession().mask.claudeThinking;
  function switchClaudeThinking() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.claudeThinking = !session.mask.claudeThinking;
    });
  }

  // switch web search
  const webSearch = chatStore.currentSession().mask.webSearch;
  function switchWebSearch() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.webSearch =
        !session.mask.webSearch &&
        !isFunctionCallModel(currentModel) &&
        isEnableWebSearch;
    });
  }

  // switch Plugins
  const usePlugins = chatStore.currentSession().mask.usePlugins;
  function switchUsePlugins() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.usePlugins = !session.mask.usePlugins;
    });
  }

  // stop all responses
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // switch model
  const currentModel = session.mask.modelConfig.model;
  const currentProviderName =
    session.mask.modelConfig?.providerName || ServiceProvider.OpenAI;
  const allModels = useAllModels();
  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    const defaultModel = filteredModels.find((m) => m.isDefault);

    const groupedModels = filteredModels.sort((a, b) => {
      const providerA = a.provider?.providerName || "";
      const providerB = b.provider?.providerName || "";
      return providerA.localeCompare(providerB);
    });

    if (defaultModel) {
      const arr = [
        defaultModel,
        ...groupedModels.filter((m) => m !== defaultModel),
      ];
      return arr;
    } else {
      return groupedModels;
    }
  }, [allModels]);

  const currentModelName = useMemo(() => {
    const model = models.find(
      (m) =>
        m.name == currentModel &&
        m?.provider?.providerName == currentProviderName,
    );
    return model?.displayName ?? "";
  }, [models, currentModel, currentProviderName]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);
  const [showUploadFile, setShowUploadFile] = useState(false);

  const isMobileScreen = useMobileScreen();

  const accessStore = useAccessStore();
  const isEnableRAG = useMemo(
    () => accessStore.enableRAG(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const isDisableModelProviderDisplay = useMemo(
    () => accessStore.isDisableModelProviderDisplay(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const isEnableWebSearch = useMemo(
    () => accessStore.enableWebSearch(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const show = isVisionModel(currentModel);
    setShowUploadImage(show && isMobileScreen);
    setShowUploadFile(isEnableRAG && isSupportRAGModel(currentModel));
    if (!show) {
      props.setAttachImages([]);
      props.setUploading(false);
    }

    // if current model is not available
    // switch to first available model
    const isUnavailableModel = !models.some((m) => m.name === currentModel);
    if (isUnavailableModel && models.length > 0) {
      // show next model to default model if exist
      let nextModel = models.find((model) => model.isDefault) || models[0];
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.model = nextModel.name;
        session.mask.modelConfig.providerName = nextModel?.provider
          ?.providerName as ServiceProvider;
      });
    }
  }, [chatStore, currentModel, models, session]);

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
        {showUploadFile && (
          <ChatAction
            onClick={props.uploadFile}
            text={Locale.Chat.InputActions.UploadFle}
            icon={props.uploading ? <LoadingButtonIcon /> : <UploadIcon />}
            alwaysFullWidth={false}
          />
        )}

        {config.pluginConfig.enable && isFunctionCallModel(currentModel) && (
          <ChatAction
            onClick={switchUsePlugins}
            text={
              usePlugins
                ? Locale.Chat.InputActions.DisablePlugins
                : Locale.Chat.InputActions.EnablePlugins
            }
            icon={usePlugins ? <EnablePluginIcon /> : <DisablePluginIcon />}
            alwaysFullWidth={false}
          />
        )}

        <ChatAction
          onClick={() => setShowModelSelector(true)}
          text={currentModelName}
          icon={<RobotIcon />}
          alwaysFullWidth={true}
        />
        {!isMobileScreen && (
          <ChatAction
            onClick={() => {
              chatStore.updateTargetSession(session, (s) => {
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

        {isClaudeThinkingModel(currentModel) && (
          <ChatAction
            onClick={switchClaudeThinking}
            text={
              claudeThinking
                ? Locale.Chat.InputActions.DisableThinking
                : Locale.Chat.InputActions.EnableThinking
            }
            icon={
              claudeThinking ? <EnableThinkingIcon /> : <DisableThinkingIcon />
            }
            alwaysFullWidth={false}
          />
        )}

        {showModelSelector && (
          <SearchSelector
            defaultSelectedValue={`${currentModel}@${currentProviderName}`}
            items={models.map((m) => ({
              title: `${m.displayName}${
                m?.provider?.providerName && !isDisableModelProviderDisplay
                  ? "(" + m?.provider?.providerName + ")"
                  : ""
              }`,
              value: `${m.name}@${m?.provider?.providerName}`,
            }))}
            onClose={() => setShowModelSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const [model, providerName] = getModelProvider(s[0]);
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.model = model as ModelType;
                session.mask.modelConfig.providerName =
                  providerName as ServiceProvider;
                session.mask.syncGlobalConfig = false;
              });
            }}
          />
        )}

        {showPluginSelector && (
          <Selector
            multiple
            defaultSelectedValue={chatStore.currentSession().mask?.plugin}
            items={pluginStore.getAll().map((item) => ({
              title: `${item?.title}@${item?.version}`,
              value: item?.id,
            }))}
            onClose={() => setShowPluginSelector(false)}
            onSelection={(s) => {
              chatStore.updateTargetSession(session, (session) => {
                session.mask.plugin = s as string[];
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

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());

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
              chatStore.updateTargetSession(
                session,
                (session) => (session.messages = messages),
              );
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
              value={session.topic}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  chatStore.updateTargetSession(
                    session,
                    (session) => (session.topic = e.currentTarget.value),
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
        <div>Context prompts are no longer available.</div>
      </Modal>
    </div>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
  );
}

export function DeleteFileButton(props: { deleteFile: () => void }) {
  return (
    <div className={styles["delete-file"]} onClick={props.deleteFile}>
      <DeleteIcon />
    </div>
  );
}

export function SystemPromptEditModal(props: {
  onClose: () => void;
  sessionId: string;
  onSave: (
    content: string,
    images: string[],
    scrollTop?: number,
    selection?: { start: number; end: number },
  ) => void;
  initialContent: string;
  initialImages: string[];
  initialScrollTop?: number;
  initialSelection?: { start: number; end: number };
}) {
  const [content, setContent] = useState(props.initialContent);
  const [attachImages, setAttachImages] = useState<string[]>(
    props.initialImages,
  );
  const [uploading, setUploading] = useState(false);
  const [scrollTop, setScrollTop] = useState(props.initialScrollTop || 0);
  const [selection, setSelection] = useState(
    props.initialSelection || { start: 0, end: 0 },
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const config = useAppConfig();

  // 自动聚焦并定位到保存的位置
  useEffect(() => {
    setTimeout(() => {
      if (inputRef.current) {
        // 设置滚动位置
        inputRef.current.scrollTop = scrollTop;
        // 设置光标位置
        if (selection.start !== selection.end) {
          inputRef.current.setSelectionRange(selection.start, selection.end);
        } else {
          inputRef.current.setSelectionRange(selection.start, selection.start);
        }
        inputRef.current.focus();
      }
    }, 100);
  }, [scrollTop, selection]);

  // 使用自定义 hook 处理粘贴上传图片
  const handlePaste = usePasteImageUpload(
    attachImages,
    setAttachImages,
    setUploading,
    setContent,
  );

  const handleSave = () => {
    // 获取当前的滚动位置和光标位置
    const currentScrollTop = inputRef.current?.scrollTop || 0;
    const currentSelectionStart = inputRef.current?.selectionStart || 0;
    const currentSelectionEnd = inputRef.current?.selectionEnd || 0;

    props.onSave(content.trim(), attachImages, currentScrollTop, {
      start: currentSelectionStart,
      end: currentSelectionEnd,
    });
    props.onClose();
  };

  return (
    <div className="modal-mask">
      <Modal
        title="编辑系统提示词"
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={props.onClose}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={handleSave}
          />,
        ]}
      >
        <div className={styles["system-prompt-edit-container"]}>
          <MessageContentEditPanel
            value={content}
            images={attachImages}
            onChange={(newContent, newImages) => {
              setContent(newContent);
              setAttachImages(newImages);
            }}
            textareaRef={inputRef}
            uploading={uploading}
            setUploading={setUploading}
            handlePaste={handlePaste}
            fontSize={config.fontSize}
            fontFamily={config.fontFamily}
            onConfirm={handleSave}
          />
        </div>
      </Modal>
    </div>
  );
}

// 修改三击事件处理函数
function useTripleClick(messageEditRef: React.RefObject<HTMLElement>) {
  const [lastClickTime, setLastClickTime] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [lastClickX, setLastClickX] = useState(0);
  const [lastClickY, setLastClickY] = useState(0);

  const handleClick = (
    e: React.MouseEvent,
    callback: (select: { anchorText: string; extendText: string }) => void,
  ) => {
    const now = Date.now();
    const currentX = e.clientX;
    const currentY = e.clientY;

    setLastClickTime(now);
    setLastClickX(currentX);
    setLastClickY(currentY);

    // 定义点击位置的最大允许偏差（像素）
    const MAX_POSITION_DIFF = 1;

    // 检查点击位置是否相近
    const isPositionClose =
      Math.abs(currentX - lastClickX) <= MAX_POSITION_DIFF &&
      Math.abs(currentY - lastClickY) <= MAX_POSITION_DIFF;

    if (now - lastClickTime > 300 || !isPositionClose) {
      // 如果时间间隔过长或位置相差太大，重置计数
      setClickCount(1);
    } else {
      // 只有在位置相近时才增加计数
      setClickCount((prev) => prev + 1);

      const selection = window.getSelection();

      if (clickCount === 2) {
        // 第三次点击
        setClickCount(0);
        const anchorText = selection?.anchorNode?.textContent;
        const extendText = selection?.focusNode?.textContent;
        callback({
          anchorText: anchorText ?? "",
          extendText: extendText ?? "",
        });
      }
    }
  };

  return handleClick;
}

// 自定义 hook：处理粘贴上传图片
function usePasteImageUpload(
  attachImages: string[],
  setAttachImages: (images: string[]) => void,
  setUploading: (uploading: boolean) => void,
  onContentChange?: (content: string) => void,
) {
  const chatStore = useChatStore();

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = chatStore.currentSession().mask.modelConfig.model;
      if (!isVisionModel(currentModel)) {
        return;
      }
      const items = (event.clipboardData || window.clipboardData).items;
      const imageFiles: File[] = [];

      // 收集所有图片文件
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      // 如果有图片文件，处理上传
      if (imageFiles.length > 0) {
        event.preventDefault();
        const images: string[] = [];
        images.push(...attachImages);

        try {
          setUploading(true);
          const uploadPromises = imageFiles.map((file) =>
            uploadImageRemote(file),
          );
          const uploadedImages = await Promise.all(uploadPromises);
          images.push(...uploadedImages);

          setAttachImages(images);
        } catch (e) {
          console.error("上传粘贴图片失败:", e);
          showToast("图片上传失败，请重试");
        } finally {
          setUploading(false);
        }
      }

      // 粘贴文本后，确保内容及时更新
      if (onContentChange) {
        setTimeout(() => {
          if (event.currentTarget) {
            onContentChange(event.currentTarget.value);
          }
        }, 0);
      }
    },
    [attachImages, chatStore, setAttachImages, setUploading, onContentChange],
  );

  return handlePaste;
}

// 新增：消息操作按钮组件
function MessageActions(props: {
  message: ChatMessage;
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  index: number;
}) {
  const { message, onResend, onDelete, onUserStop, index } = props;

  return (
    <div className={styles["chat-input-actions"]}>
      {message.streaming ? (
        <ChatAction
          text={Locale.Chat.Actions.Stop}
          icon={<StopIcon />}
          onClick={() => onUserStop(message.id ?? index)}
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
            onClick={() => onDelete(message.id ?? index)}
            alwaysFullWidth={false}
          />
        </>
      )}
    </div>
  );
}

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const accessStore = useAccessStore();
  const allModels = useAllModels();

  // 记住未完成输入的防抖保存函数，间隔放宽到 500ms
  const saveChatInputText = useDebouncedCallback(async (value: string) => {
    try {
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, {
        ...currentData,
        text: value,
        updateAt: Date.now(),
      });
      // console.log("[ChatInput][Save] 保存未完成输入到 IndexedDB:", value);
    } catch (e) {
      console.error("[ChatInput][Save] 保存未完成输入失败:", e);
    }
  }, 500);

  // 立即保存 scrollTop
  async function saveChatInputScrollTop(scrollTop: number) {
    try {
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, {
        ...currentData,
        scrollTop,
        updateAt: Date.now(),
      });
      // console.log("[ChatInput][Save] 保存 scrollTop 到 IndexedDB:", scrollTop);
    } catch (e) {
      console.error("[ChatInput][Save] 保存 scrollTop 失败:", e);
    }
  }

  // 保存光标位置
  async function saveChatInputSelection(selection: {
    start: number;
    end: number;
  }) {
    try {
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, {
        ...currentData,
        selection,
        updateAt: Date.now(),
      });
      // console.log("[ChatInput][Save] 保存光标位置到 IndexedDB:", selection);
    } catch (e) {
      console.error("[ChatInput][Save] 保存光标位置失败:", e);
    }
  }

  // 加载聊天输入数据
  async function loadChatInputData() {
    try {
      const data = await chatInputStorage.getChatInput(session.id);
      if (data) {
        // console.log("[ChatInput][Load] 从 IndexedDB 加载数据:", data);
        return data;
      }
    } catch (e) {
      console.error("[ChatInput][Load] 加载聊天输入数据失败:", e);
    }
    return {
      text: "",
      images: [],
      scrollTop: 0,
      selection: { start: 0, end: 0 },
      updateAt: Date.now(),
    };
  }

  // 保存图片数据
  async function saveChatInputImages(images: string[]) {
    try {
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, {
        ...currentData,
        images,
        updateAt: Date.now(),
      });
      // console.log("[ChatInput][Save] 保存图片到 IndexedDB:", images);
    } catch (e) {
      console.error("[ChatInput][Save] 保存图片失败:", e);
    }
  }

  // 自动修正模型配置
  useEffect(() => {
    // 获取当前模型和 provider
    const { model, providerName, compressModel, compressProviderName } =
      config.modelConfig;
    // 检查主模型是否有效
    const isModelValid = allModels.some(
      (m) =>
        m.name === model &&
        m.provider?.providerName === providerName &&
        m.available,
    );
    // 检查压缩模型是否有效
    const isCompressModelValid = allModels.some(
      (m) =>
        m.name === compressModel &&
        m.provider?.providerName === compressProviderName &&
        m.available,
    );
    // console.log("[updateConfig] isModelValid", isModelValid);
    // console.log("[updateConfig] isCompressModelValid", isCompressModelValid);
    // 如果主模型或压缩模型无效，自动 fetch 并更新为 defaultModel
    if (!isModelValid || !isCompressModelValid) {
      // 拉取服务器配置，获取 defaultModel
      accessStore.fetch();
      // 取最新 defaultModel
      const defaultModelStr = accessStore.defaultModel;
      if (defaultModelStr) {
        const [defaultModel, defaultProvider] =
          getModelProvider(defaultModelStr);
        config.update((cfg) => {
          // 主模型无效时修正
          if (!isModelValid) {
            cfg.modelConfig.model = defaultModel;
            cfg.modelConfig.providerName = defaultProvider as any;
            console.log(
              "[updateConfig] cfg.modelConfig.model",
              cfg.modelConfig.model,
            );
            console.log(
              "[updateConfig] cfg.modelConfig.providerName",
              cfg.modelConfig.providerName,
            );
          }
          // 压缩模型无效时修正
          if (!isCompressModelValid) {
            cfg.modelConfig.compressModel = defaultModel;
            cfg.modelConfig.compressProviderName = defaultProvider as any;
            console.log(
              "[updateConfig] cfg.modelConfig.compressModel",
              cfg.modelConfig.compressModel,
            );
            console.log(
              "[updateConfig] cfg.modelConfig.compressProviderName",
              cfg.modelConfig.compressProviderName,
            );
          }
        });
      }
    }
  }, [accessStore]);

  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageItemRef = useRef<HTMLDivElement>(null);
  const messageEditRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [isLargeInput, setIsLargeInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const isAttachWithTop = useMemo(() => {
    const lastMessage = scrollRef.current?.lastElementChild as HTMLElement;
    // if scrolllRef is not ready or no message, return false
    if (!scrollRef?.current || !lastMessage) return false;
    const topDistance =
      lastMessage!.getBoundingClientRect().top -
      scrollRef.current.getBoundingClientRect().top;
    // leave some space for user question
    return topDistance < 100;
  }, [scrollRef?.current?.scrollHeight]);

  const isTyping = userInput !== "";

  // if user is typing, should auto scroll to bottom
  // if user is not typing, should auto scroll to bottom only if already at bottom
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    (isScrolledToBottom || isAttachWithTop) && !isTyping,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachFiles, setAttachFiles] = useState<FileInfo[]>([]);

  // 移动端默认开启长输入模式
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      chatStore.updateTargetSession(session, (session) => {
        session.longInputMode = true;
      });
    }
  }, [isMobileScreen, session.longInputMode, chatStore]);

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateTargetSession(
        session,
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    fork: () => chatStore.forkSession(),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  useEffect(() => {
    // 启动时数据迁移
    const migrateData = async () => {
      try {
        // 检查是否已经迁移过
        const migrationKey = "chat-input-system-migration-completed";
        if (localStorage.getItem(migrationKey)) {
          console.log("[Migration] 聊天输入和系统消息数据已迁移，跳过");
          return;
        }

        console.log(
          "[Migration] 开始迁移聊天输入和系统消息数据到 IndexedDB...",
        );

        // 扫描 localStorage 中的聊天输入数据
        const chatInputKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith("chat-input-text-") ||
              key.startsWith("chat-input-images-") ||
              key.startsWith("chat-input-scroll-top-"))
          ) {
            chatInputKeys.push(key);
          }
        }

        if (chatInputKeys.length === 0) {
          console.log("[Migration] 没有找到需要迁移的聊天输入数据");
        }

        // 迁移聊天输入数据
        if (chatInputKeys.length > 0) {
          const sessionData: {
            [sessionId: string]: {
              text: string;
              images: string[];
              scrollTop: number;
              selection: { start: number; end: number };
            };
          } = {};

          chatInputKeys.forEach((key) => {
            const sessionId = key
              .replace("chat-input-text-", "")
              .replace("chat-input-images-", "")
              .replace("chat-input-scroll-top-", "");

            if (!sessionData[sessionId]) {
              sessionData[sessionId] = {
                text: "",
                images: [],
                scrollTop: 0,
                selection: { start: 0, end: 0 },
              };
            }

            if (key.startsWith("chat-input-text-")) {
              sessionData[sessionId].text = localStorage.getItem(key) || "";
            } else if (key.startsWith("chat-input-images-")) {
              try {
                const images = JSON.parse(localStorage.getItem(key) || "[]");
                if (Array.isArray(images)) {
                  sessionData[sessionId].images = images;
                }
              } catch (e) {
                console.error("[Migration] 解析图片数据失败:", e);
              }
            } else if (key.startsWith("chat-input-scroll-top-")) {
              sessionData[sessionId].scrollTop =
                Number(localStorage.getItem(key)) || 0;
            }
          });

          // 迁移到 IndexedDB
          let migratedCount = 0;
          for (const [sessionId, data] of Object.entries(sessionData)) {
            if (data.text || data.images.length > 0 || data.scrollTop > 0) {
              await chatInputStorage.saveChatInput(sessionId, {
                text: data.text,
                images: data.images,
                scrollTop: data.scrollTop,
                selection: data.selection,
                updateAt: Date.now(),
              });
              migratedCount++;
            }
          }

          // 清理 localStorage 中的旧数据
          chatInputKeys.forEach((key) => {
            localStorage.removeItem(key);
          });

          console.log(
            `[Migration] 成功迁移 ${migratedCount} 个会话的聊天输入数据`,
          );
        }

        // 迁移 IndexedDB 中的旧格式系统消息数据
        const systemMigratedCount =
          await systemMessageStorage.migrateOldFormatData();
        if (systemMigratedCount > 0) {
          console.log(
            `[Migration] 成功迁移 ${systemMigratedCount} 个会话的 IndexedDB 系统消息数据`,
          );
        }

        localStorage.setItem(migrationKey, "true");
      } catch (error) {
        console.error("[Migration] 迁移数据失败:", error);
      }
    };

    // 执行迁移
    migrateData();

    // 从 IndexedDB 加载聊天输入数据
    const loadData = async () => {
      const data = await loadChatInputData();
      if (inputRef.current) {
        inputRef.current.value = data.text;
        inputRef.current.scrollTop = data.scrollTop;
        // 设置光标位置
        if (data.selection.start !== data.selection.end) {
          inputRef.current.setSelectionRange(
            data.selection.start,
            data.selection.end,
          );
        } else {
          inputRef.current.setSelectionRange(
            data.selection.start,
            data.selection.start,
          );
        }
      }
      setUserInput(data.text);
      setAttachImages(data.images);
    };

    loadData();
  }, []);

  // onInput 只做本地保存，不 setUserInput
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    saveChatInputText(text); // 只防抖保存 text
    // 保存光标位置
    if (event?.currentTarget) {
      const selectionStart = event.currentTarget.selectionStart;
      const selectionEnd = event.currentTarget.selectionEnd;
      saveChatInputSelection({ start: selectionStart, end: selectionEnd });
    }
    // 只要内容有换行或长度变化较大（如粘贴/多行输入），就 setUserInput
    if (
      text.includes("\n") ||
      (userInput && Math.abs(text.length - userInput.length) > 1)
    ) {
      setUserInput(text);
    }
  };

  const doSubmit = (input: string) => {
    const value = inputRef.current?.value ?? input;
    if (value.trim() === "" && isEmpty(attachImages)) return;
    const matchCommand = chatCommands.match(value);
    if (matchCommand.matched) {
      setUserInput("");
      matchCommand.invoke();
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setIsLoading(true);
    chatStore
      .onUserInput(value, attachImages, attachFiles)
      .then(() => setIsLoading(false));
    setAttachImages([]);
    setAttachFiles([]);
    chatStore.setLastInput(value);
    setUserInput("");
    if (inputRef.current) inputRef.current.value = "";

    // 清理 IndexedDB 中的聊天输入数据
    const clearChatInput = async () => {
      try {
        await chatInputStorage.saveChatInput(session.id, {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        });
      } catch (e) {
        console.error("[ChatInput][Clear] 清理聊天输入数据失败:", e);
      }
    };
    clearChatInput();

    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          // 排除系统消息和已迁移的系统消息（有contentKey的消息）
          if (
            m.content.length === 0 &&
            m.role !== "system" &&
            !(m as any).contentKey
          ) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // auto sync mask config from global config
      if (session.mask.syncGlobalConfig) {
        console.log("[Mask] syncing from global, name = ", session.mask.name);
        session.mask.modelConfig = { ...config.modelConfig };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果是长输入模式，Enter 换行，Ctrl+Enter 发送
    if (session.longInputMode) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        doSubmit(userInput);
        e.preventDefault();
      }
      // 仅 Enter 时不发送，交给浏览器默认行为（换行）
      return;
    }
    // 普通模式
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e)) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateTargetSession(
      session,
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    // 保存删除前的 messages 状态
    const prevMessages = session.messages.slice();

    deleteMessage(msgId);

    // 显示 Toast，提供撤销按钮
    showToast(
      Locale.Home.DeleteToast, // 你可以在 Locale 里加一个类似 "消息已删除"
      {
        text: Locale.Home.Revert, // 你可以在 Locale 里加一个 "撤销"
        onClick() {
          chatStore.updateTargetSession(
            session,
            (session) => (session.messages = prevMessages),
          );
        },
      },
      5000,
    );
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    let requestIndex = resendingIndex;

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          requestIndex = i;
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // resend the message
    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore
      .onUserInput(
        textContent,
        images,
        userMessage.fileInfos,
        userMessage.webSearchReferences,
        requestIndex,
      )
      .then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) =>
      session.mask.context.push(message),
    );

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  // 优化点1：渲染相关 useMemo/useState/useEffect 彻底排除 system message
  // context 只保留 mask.context，不包含 system message
  const context: RenderMessage[] = useMemo(() => {
    return session.mask.hideContext ? [] : session.mask.context.slice();
  }, [session.mask.context, session.mask.hideContext]);

  // 优化点2：渲染消息时彻底过滤 system message
  // 只在渲染时过滤，不影响原始 session.messages
  const filteredSessionMessages = useMemo(() => {
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  // preview messages
  const renderMessages = useMemo(() => {
    return context.concat(filteredSessionMessages).concat(
      (userInput.length > 0 && config.sendPreviewBubble
        ? [
            {
              ...createMessage({
                role: "user",
                content: userInput,
              }),
              preview: true,
            },
          ]
        : []) as RenderMessage[],
    );
  }, [
    config.sendPreviewBubble,
    context,
    isLoading,
    filteredSessionMessages,
    userInput,
  ]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  // 监听 renderMessages 长度变化，确保 msgRenderIndex 始终正确
  useEffect(() => {
    const newIndex = Math.max(0, renderMessages.length - CHAT_PAGE_SIZE);
    if (newIndex !== msgRenderIndex) {
      _setMsgRenderIndex(newIndex);
    }
  }, [renderMessages.length, msgRenderIndex]);

  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };
  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (text) => {
      if (accessStore.disableFastLink) return;
      console.log("[Command] got code from url: ", text);
      showConfirm(Locale.URLCommand.Code + `code = ${text}`).then((res) => {
        if (res) {
          accessStore.update((access) => (access.accessCode = text));
        }
      });
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
          code?: string;
        };

        console.log("[Command] got settings from url: ", payload);

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update((access) => (access.openaiUrl = payload.url!));
            }
            accessStore.update((access) => (access.useCustomConfig = true));
          });
        }

        if (payload.code) {
          accessStore.update((access) => (access.accessCode = payload.code!));
          if (accessStore.isAuthorized()) {
            context.pop();
          }
        }
      } catch {
        console.error("[Command] failed to get settings from url: ", text);
      }
    },
  });

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  // 使用自定义 hook 处理粘贴上传图片
  const handlePaste = usePasteImageUpload(
    attachImages,
    async (images) => {
      setAttachImages(images);
      await saveChatInputImages(images);
    },
    setUploading,
    (content) => {
      setUserInput(content);
      saveChatInputText(content);
      console.log("[ChatInput][Save][Paste] 粘贴后保存未完成输入:", content);
    },
  );

  async function capturePhoto() {
    const images: string[] = [];
    images.push(...attachImages);

    // 使用原生相机拍照
    const newImages = await new Promise<string[]>((resolve, reject) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.capture = "environment"; // 调用后置摄像头
      fileInput.multiple = false;

      fileInput.onchange = async (event: any) => {
        const file = event.target.files?.[0];
        if (!file) {
          resolve([]);
          return;
        }

        try {
          setUploading(true);
          const dataUrl = await uploadImageRemote(file);
          setUploading(false);
          resolve([dataUrl]);
        } catch (error) {
          setUploading(false);
          console.error("上传拍照图片失败:", error);
          showToast("图片上传失败，请重试");
          reject(error);
        }
      };

      // 如果用户取消拍照，也需要处理
      fileInput.oncancel = () => {
        resolve([]);
      };

      fileInput.click();
    });

    if (newImages.length > 0) {
      images.push(...newImages);
      setAttachImages(images);
      await saveChatInputImages(images);
    }
  }

  async function uploadImage() {
    const images: string[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<string[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif, image/gif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            uploadImageRemote(file)
              .then((dataUrl) => {
                imagesData.push(dataUrl);
                if (imagesData.length === files.length) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    setAttachImages(images);
    await saveChatInputImages(images); // 新增：保存图片
  }

  async function uploadFile() {
    const uploadFiles: FileInfo[] = [];
    uploadFiles.push(...attachFiles);

    uploadFiles.push(
      ...(await new Promise<FileInfo[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".pdf,.txt,.md,.json,.csv,.docx,.srt,.mp3";
        fileInput.multiple = false;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const file = event.target.files[0];
          const api = new ClientApi();
          const fileDatas: FileInfo[] = [];
          api.file
            .uploadForRag(file, session)
            .then((fileInfo) => {
              console.log(fileInfo);
              fileDatas.push(fileInfo);
              session.attachFiles.push(fileInfo);
              setUploading(false);
              res(fileDatas);
            })
            .catch((e) => {
              setUploading(false);
              rej(e);
            });
        };
        fileInput.click();
      })),
    );

    const filesLength = uploadFiles.length;
    if (filesLength > 5) {
      uploadFiles.splice(5, filesLength - 5);
    }
    setAttachFiles(uploadFiles);
  }

  const [showChatSidePanel, setShowChatSidePanel] = useState(false);
  const [showSystemPromptEdit, setShowSystemPromptEdit] = useState(false);
  const [systemPromptData, setSystemPromptData] = useState<SystemMessageData>({
    text: "",
    images: [],
    scrollTop: 0,
    selection: { start: 0, end: 0 },
    updateAt: Date.now(),
  });

  const handleTripleClick = useTripleClick(messageEditRef);

  // 处理系统提示词保存
  const handleSystemPromptSave = (
    content: string,
    images: string[],
    scrollTop?: number,
    selection?: { start: number; end: number },
  ) => {
    chatStore.updateTargetSession(session, (session) => {
      // 移除现有的 system 消息
      session.messages = session.messages.filter((m) => m.role !== "system");
      if (content.trim() || images.length > 0) {
        saveSystemMessageContentToStorage(
          session.id,
          content.trim(),
          images,
          scrollTop || 0,
          selection || { start: 0, end: 0 },
        );
        const newSystemMessage = createMessage({
          role: "system",
          content: "", // 不存内容
        }) as SystemMetaMessage;
        // @ts-ignore
        newSystemMessage.contentKey = getSystemMessageContentKey(session.id);
        session.messages.unshift(newSystemMessage);
      }
    });
  };

  // 修改编辑消息处理函数
  const [showEditMessageModal, setShowEditMessageModal] = useState(false);
  const [editMessageData, setEditMessageData] = useState<{
    message: ChatMessage;
    type: "content" | "reasoningContent";
    select: { anchorText: string; extendText: string };
  } | null>(null);

  const handleEditMessage = async (
    message: ChatMessage,
    type: "content" | "reasoningContent" = "content",
    select: { anchorText: string; extendText: string } = {
      anchorText: "",
      extendText: "",
    },
  ) => {
    if (message.streaming) return;
    setEditMessageData({ message, type, select });
    setShowEditMessageModal(true);

    // 用户消息或系统提示词，光标定位到最后
    if (message.role === "user" || message.role === "system") {
      setTimeout(() => {
        if (messageEditRef.current) {
          const textarea = messageEditRef.current;
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
          textarea.focus();
        }
      }, 100);
      return;
    }
    // 模型消息才执行三击定位
    if (select.anchorText || select.extendText) {
      setTimeout(() => {
        if (messageEditRef.current) {
          const textarea = messageEditRef.current;
          let searchText = select.anchorText || select.extendText;
          if (!searchText) return;
          let textContent =
            type === "content"
              ? getMessageTextContent(message)
              : getMessageTextReasoningContent(message);
          const searchIndex = textContent.indexOf(searchText);
          if (searchIndex === -1) return;
          const contentBeforeSearch = textContent.substring(0, searchIndex);
          const lineNumber = contentBeforeSearch.split("\n").length;
          const style = window.getComputedStyle(textarea);
          const lineHeight = parseInt(style.lineHeight);
          const position = (lineNumber - 1) * (lineHeight || 21);
          textarea.scrollTo({
            top: Math.max(0, position),
            behavior: "smooth",
          });
        }
      }, 100);
    }
  };

  const [messageHeights, setMessageHeights] = useState<{
    [key: string]: number;
  }>({});
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // 使用 useEffect 和 ResizeObserver 来监听消息高度变化
  useEffect(() => {
    const observers = new Map<string, ResizeObserver>();

    // 清理函数
    const cleanup = () => {
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
    };

    // 为每个消息创建 ResizeObserver
    Object.entries(messageRefs.current).forEach(([messageId, element]) => {
      if (!element) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const height = entry.contentRect.height;
          setMessageHeights((prev) => {
            // 只有当高度真正改变时才更新状态
            if (prev[messageId] === height) return prev;
            return {
              ...prev,
              [messageId]: height,
            };
          });
        }
      });

      observer.observe(element);
      observers.set(messageId, observer);
    });

    return cleanup;
  }, [session.messages.length]); // 只在消息列表长度变化时重新设置观察者

  // ========== system message content 存储工具 ==========
  // @ts-ignore
  interface SystemMetaMessage extends ChatMessage {
    contentKey?: string;
  }

  interface SystemMessageData {
    text: string;
    images: string[];
    scrollTop: number;
    selection: { start: number; end: number };
    updateAt: number;
  }

  function getSystemMessageContentKey(sessionId: string) {
    return sessionId;
  }

  async function saveSystemMessageContentToStorage(
    sessionId: string,
    content: string,
    images: string[] = [],
    scrollTop: number = 0,
    selection: { start: number; end: number } = { start: 0, end: 0 },
  ) {
    try {
      // 保存文本和图片数据
      const data: SystemMessageData = {
        text: content,
        images,
        scrollTop,
        selection,
        updateAt: Date.now(),
      };
      const success = await systemMessageStorage.saveSystemMessage(
        sessionId,
        data,
      );
      if (!success) {
        throw new Error("保存到 IndexedDB 失败");
      }
    } catch (error) {
      console.error("保存系统消息失败:", error);
      alert("系统提示词保存失败，请重试。");
    }
  }

  async function loadSystemMessageContentFromStorage(
    sessionId: string,
  ): Promise<SystemMessageData> {
    try {
      const data = await systemMessageStorage.getSystemMessage(sessionId);
      if (!data) {
        return {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        };
      }
      return data;
    } catch (error) {
      console.error("读取系统消息失败:", error);
      return {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
    }
  }
  // ... existing code ...
  // 编辑系统提示词逻辑，保存到 localStorage，只存 meta
  // ... window-actions 编辑上下文按钮 ...
  return (
    <>
      <div className={styles.chat} key={session.id}>
        <div className="window-header" data-tauri-drag-region>
          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
              onClickCapture={() => setIsEditingMessage(true)}
            >
              {!session.topic ? DEFAULT_TOPIC : session.topic}
            </div>
            {!isMobileScreen && (
              <div className="window-header-sub-title">
                {Locale.Chat.SubTitle(session.messages.length)}
              </div>
            )}
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<EditIcon />}
                bordered
                title="编辑上下文"
                onClick={async () => {
                  // 获取当前 session 的 system 消息
                  let systemMessage = session.messages.find(
                    (m) => m.role === "system",
                  ) as SystemMetaMessage | undefined;
                  let systemData: SystemMessageData = {
                    text: "",
                    images: [],
                    scrollTop: 0,
                    selection: { start: 0, end: 0 },
                    updateAt: Date.now(),
                  };

                  // 如果存在 system 消息且有 contentKey，从 storage 加载
                  if (systemMessage && systemMessage.contentKey) {
                    systemData = await loadSystemMessageContentFromStorage(
                      session.id,
                    );
                  } else if (systemMessage?.content) {
                    // 兼容旧格式
                    if (typeof systemMessage.content === "string") {
                      systemData = {
                        text: systemMessage.content,
                        images: [],
                        scrollTop: 0,
                        selection: { start: 0, end: 0 },
                        updateAt: Date.now(),
                      };
                    } else if (Array.isArray(systemMessage.content)) {
                      const textContent = systemMessage.content
                        .filter((c: any) => c.type === "text")
                        .map((c: any) => c.text)
                        .join("");
                      const images = systemMessage.content
                        .filter((c: any) => c.type === "image_url")
                        .map((c: any) => c.image_url?.url)
                        .filter(Boolean);
                      systemData = {
                        text: textContent,
                        images,
                        scrollTop: 0,
                        selection: { start: 0, end: 0 },
                        updateAt: Date.now(),
                      };
                    }
                  }

                  // 设置数据并显示编辑模态框
                  setSystemPromptData(systemData);
                  setShowSystemPromptEdit(true);
                }}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<ExportIcon />}
                bordered
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  setShowExport(true);
                }}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<DeleteIcon />}
                bordered
                title={Locale.Chat.Actions.Delete}
                onClick={async () => {
                  chatStore.deleteSession(chatStore.currentSessionIndex);
                }}
              />
            </div>
          </div>

          <PromptToast
            showToast={!hitBottom}
            showModal={showPromptModal}
            setShowModal={setShowPromptModal}
          />
        </div>
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <div
              className={styles["chat-body"]}
              ref={scrollRef}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
                setAutoScroll(false);
              }}
            >
              {messages.map((message, i) => {
                const isUser = message.role === "user";
                const isSystem = message.role === "system";
                const isContext = i < context.length;
                const showActions =
                  !(message.preview || message.content.length === 0) &&
                  !isContext;
                const showTyping = message.preview || message.streaming;

                const shouldShowClearContextDivider =
                  i === clearContextIndex - 1;

                // 系统级提示词在会话界面中隐藏
                if (isSystem) {
                  return null;
                }

                return (
                  <Fragment key={message.id}>
                    <div
                      className={
                        isUser
                          ? styles["chat-message-user"]
                          : styles["chat-message"]
                      }
                    >
                      <div
                        className={
                          styles["chat-message-container"] +
                          " " +
                          (isUser
                            ? styles["chat-message-container-user"]
                            : styles["chat-message-container-assistant"])
                        }
                      >
                        <div className={styles["chat-message-header"]}>
                          {!isUser && (
                            <div className={styles["chat-model-name"]}>
                              {message.model}
                            </div>
                          )}

                          {showActions && (
                            <div className={styles["chat-message-actions"]}>
                              <MessageActions
                                message={message}
                                onResend={onResend}
                                onDelete={onDelete}
                                onUserStop={onUserStop}
                                index={i}
                              />
                            </div>
                          )}
                        </div>
                        {!isUser &&
                          message.toolMessages &&
                          message.toolMessages.map((tool, index) => (
                            <div
                              className={styles["chat-message-tools-status"]}
                              key={index}
                            >
                              <div
                                className={styles["chat-message-tools-name"]}
                              >
                                <CheckmarkIcon
                                  className={styles["chat-message-checkmark"]}
                                />
                                {tool.toolName}:
                                <code
                                  className={
                                    styles["chat-message-tools-details"]
                                  }
                                >
                                  {tool.toolInput}
                                </code>
                              </div>
                            </div>
                          ))}
                        {message?.tools?.length == 0 && showTyping && (
                          <div className={styles["chat-message-status"]}>
                            {Locale.Chat.Typing}
                          </div>
                        )}
                        {/*@ts-ignore*/}
                        {message?.tools?.length > 0 && (
                          <div className={styles["chat-message-tools"]}>
                            {message?.tools?.map((tool) => (
                              <div
                                key={tool.id}
                                title={tool?.errorMsg}
                                className={styles["chat-message-tool"]}
                              >
                                {tool.isError === false ? (
                                  <ConfirmIcon />
                                ) : tool.isError === true ? (
                                  <CloseIcon />
                                ) : (
                                  <LoadingButtonIcon />
                                )}
                                <span>{tool?.function?.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!isUser && message.reasoningContent && (
                          <ThinkingContent
                            message={message}
                            onDoubleClick={(e) =>
                              handleTripleClick(e, (select) => {
                                handleEditMessage(
                                  message,
                                  "reasoningContent",
                                  select,
                                );
                              })
                            }
                          />
                        )}
                        <div
                          className={styles["chat-message-item"]}
                          ref={(el) => {
                            if (message.id) {
                              messageRefs.current[message.id] = el;
                            }
                          }}
                          onDoubleClick={async (e) => {
                            if (message.streaming) return;
                            // 用户消息保持双击编辑
                            if (isUser) {
                              handleEditMessage(message, "content");
                            }
                          }}
                          onClick={(e) => {
                            // 非用户消息使用三击编辑
                            if (!isUser) {
                              handleTripleClick(e, (select) => {
                                handleEditMessage(message, "content", select);
                              });
                            }
                          }}
                        >
                          {Array.isArray(message.content) ? (
                            message.content.map((content, index) => (
                              <Fragment key={index}>
                                {content.type === "text" && (
                                  <Markdown
                                    key={
                                      message.streaming
                                        ? "loading"
                                        : `text-${index}`
                                    }
                                    content={content.text || ""}
                                    webSearchReferences={
                                      message.webSearchReferences
                                    }
                                    loading={
                                      (message.preview || message.streaming) &&
                                      !content.text &&
                                      !isUser &&
                                      (
                                        message.content as MultimodalContent[]
                                      ).every((c) => c.type === "text")
                                    }
                                    onDoubleClickCapture={() => {
                                      if (!isMobileScreen) return;
                                      setUserInput(content.text || "");
                                    }}
                                    fontSize={fontSize}
                                    fontFamily={fontFamily}
                                    parentRef={scrollRef}
                                    defaultShow={i >= messages.length - 6}
                                  />
                                )}
                                {content.type === "image_url" &&
                                  content.image_url?.url && (
                                    <img
                                      className={
                                        styles["chat-message-item-image"]
                                      }
                                      src={content.image_url.url}
                                      alt=""
                                    />
                                  )}
                              </Fragment>
                            ))
                          ) : (
                            <>
                              <Markdown
                                key={message.streaming ? "loading" : "done"}
                                content={getMessageTextContent(message)}
                                webSearchReferences={
                                  message.webSearchReferences
                                }
                                loading={
                                  (message.preview || message.streaming) &&
                                  message.content.length === 0 &&
                                  !isUser
                                }
                                onDoubleClickCapture={() => {
                                  if (!isMobileScreen) return;
                                  setUserInput(getMessageTextContent(message));
                                }}
                                fontSize={fontSize}
                                fontFamily={fontFamily}
                                parentRef={scrollRef}
                                defaultShow={i >= messages.length - 6}
                              />
                              {getMessageImages(message).length == 1 && (
                                <img
                                  className={styles["chat-message-item-image"]}
                                  src={getMessageImages(message)[0]}
                                  alt=""
                                />
                              )}
                              {getMessageImages(message).length > 1 && (
                                <div
                                  className={styles["chat-message-item-images"]}
                                  style={
                                    {
                                      "--image-count":
                                        getMessageImages(message).length,
                                    } as React.CSSProperties
                                  }
                                >
                                  {getMessageImages(message).map(
                                    (image, index) => (
                                      <img
                                        className={
                                          styles[
                                            "chat-message-item-image-multi"
                                          ]
                                        }
                                        key={index}
                                        src={image}
                                        alt=""
                                      />
                                    ),
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* 将底部操作按钮组移到这里，只在非用户消息时显示 */}
                        {!isUser &&
                          messageHeights[message.id ?? ""] >
                            window.innerHeight * 0.1 && (
                            <div
                              className={styles["chat-message-bottom-actions"]}
                            >
                              <MessageActions
                                message={message}
                                onResend={onResend}
                                onDelete={onDelete}
                                onUserStop={onUserStop}
                                index={i}
                              />
                            </div>
                          )}

                        {message?.audioUrl && (
                          <div className={styles["chat-message-audio"]}>
                            <audio src={message.audioUrl} controls />
                          </div>
                        )}

                        <div className={styles["chat-message-action-date"]}>
                          {isContext
                            ? Locale.Chat.IsContext
                            : message.date.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {shouldShowClearContextDivider && <ClearContextDivider />}
                  </Fragment>
                );
              })}
            </div>
            <div className={styles["chat-input-panel"]}>
              <ChatActions
                uploadImage={uploadImage}
                capturePhoto={capturePhoto}
                setAttachImages={setAttachImages}
                uploadFile={uploadFile}
                setAttachFiles={setAttachFiles}
                setUploading={setUploading}
                showPromptModal={() => setShowPromptModal(true)}
                scrollToBottom={scrollToBottom}
                hitBottom={hitBottom}
                uploading={uploading}
                setUserInput={setUserInput}
                setShowChatSidePanel={setShowChatSidePanel}
              />
              <label
                className={clsx(styles["chat-input-panel-inner"], {
                  [styles["chat-input-panel-inner-attach"]]:
                    attachImages.length !== 0 || attachFiles.length != 0,
                })}
                htmlFor="chat-input"
              >
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  defaultValue={userInput}
                  onInput={(e) => onInput(e.currentTarget.value, e)}
                  onKeyDown={onInputKeyDown}
                  onPaste={handlePaste}
                  rows={inputRows}
                  autoFocus={autoFocus}
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily,
                  }}
                  onBlur={() => {
                    const currentValue = inputRef.current?.value ?? "";
                    setUserInput(currentValue);
                    saveChatInputText.flush && saveChatInputText.flush();
                    // 保存光标位置
                    if (inputRef.current) {
                      const selectionStart = inputRef.current.selectionStart;
                      const selectionEnd = inputRef.current.selectionEnd;
                      saveChatInputSelection({
                        start: selectionStart,
                        end: selectionEnd,
                      });
                    }
                  }}
                  onScroll={(e) => {
                    const scrollTop = e.currentTarget.scrollTop;
                    saveChatInputScrollTop(scrollTop);
                  }}
                />
                {attachImages.length != 0 && (
                  <div className={styles["attach-images"]}>
                    {attachImages.map((image, index) => {
                      return (
                        <div
                          key={index}
                          className={styles["attach-image"]}
                          style={{ backgroundImage: `url("${image}")` }}
                        >
                          <div className={styles["attach-image-mask"]}>
                            <DeleteImageButton
                              deleteImage={async () => {
                                const newImages = attachImages.filter(
                                  (_, i) => i !== index,
                                );
                                setAttachImages(newImages);
                                await saveChatInputImages(newImages);
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <IconButton
                  icon={<SendWhiteIcon />}
                  className={styles["chat-input-send"]}
                  type="primary"
                  onClick={() => doSubmit(userInput)}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showSystemPromptEdit && (
        <SystemPromptEditModal
          onClose={() => setShowSystemPromptEdit(false)}
          sessionId={session.id}
          onSave={handleSystemPromptSave}
          initialContent={systemPromptData.text}
          initialImages={systemPromptData.images}
          initialScrollTop={systemPromptData.scrollTop}
          initialSelection={systemPromptData.selection}
        />
      )}
      {showEditMessageModal && editMessageData && (
        <EditMessageWithImageModal
          onClose={() => setShowEditMessageModal(false)}
          initialContent={
            editMessageData.type === "content"
              ? getMessageTextContent(editMessageData.message)
              : getMessageTextReasoningContent(editMessageData.message)
          }
          initialImages={getMessageImages(editMessageData.message)}
          onSave={(
            newContent: string,
            newImages: string[],
            retryOnConfirm?: boolean,
          ) => {
            chatStore.updateTargetSession(session, (session) => {
              const m = session.mask.context
                .concat(session.messages)
                .find((m) => m.id === editMessageData.message.id);
              if (m) {
                if (editMessageData.type === "content") {
                  if (newImages.length > 0) {
                    m.content = [
                      { type: "text" as const, text: newContent },
                      ...newImages.map((url: string) => ({
                        type: "image_url" as const,
                        image_url: { url },
                      })),
                    ] as import("../client/api").MultimodalContent[];
                  } else {
                    m.content = newContent;
                  }
                }
                if (editMessageData.type === "reasoningContent") {
                  m.reasoningContent = newContent;
                }
              }
            });
            if (retryOnConfirm && editMessageData.message.role === "user") {
              onResend(editMessageData.message);
            }
          }}
          title={Locale.Chat.Actions.Edit}
          textareaRef={messageEditRef}
          message={editMessageData.message}
        />
      )}
    </>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const sessionIndex = chatStore.currentSessionIndex;
  return <_Chat key={sessionIndex}></_Chat>;
}

export function EditMessageWithImageModal(props: {
  onClose: () => void;
  initialContent: string;
  initialImages: string[];
  onSave: (content: string, images: string[], retryOnConfirm?: boolean) => void;
  title?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  message?: ChatMessage;
}) {
  const [content, setContent] = useState(props.initialContent);
  const [attachImages, setAttachImages] = useState<string[]>(
    props.initialImages,
  );
  const [uploading, setUploading] = useState(false);
  const config = useAppConfig();
  const handlePaste = usePasteImageUpload(
    attachImages,
    setAttachImages,
    setUploading,
    setContent,
  );
  // ctrl+enter 触发 retry
  const handleConfirm = () => {
    props.onSave(content.trim(), attachImages, true);
    props.onClose();
  };
  // 鼠标点击按钮不触发 retry
  const handleSave = () => {
    props.onSave(content.trim(), attachImages, false);
    props.onClose();
  };
  return (
    <div className="modal-mask">
      <Modal
        title={props.title || "编辑消息"}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={props.onClose}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={handleSave}
          />,
        ]}
      >
        <div className={styles["system-prompt-edit-container"]}>
          <MessageContentEditPanel
            value={content}
            images={attachImages}
            onChange={(newContent, newImages) => {
              setContent(newContent);
              setAttachImages(newImages);
            }}
            textareaRef={props.textareaRef}
            uploading={uploading}
            setUploading={setUploading}
            handlePaste={handlePaste}
            fontSize={config.fontSize}
            fontFamily={config.fontFamily}
            onConfirm={handleConfirm}
          />
        </div>
      </Modal>
    </div>
  );
}
