import { useDebouncedCallback } from "use-debounce";
import { nanoid } from "nanoid";
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
import BranchIcon from "../icons/branch.svg";

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
  DEFAULT_TOPIC,
  systemMessageStorage,
  chatInputStorage,
} from "../store";

import { createMessage, updateSessionStats } from "../utils/session";

import {
  copyToClipboard,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
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
  showImageModal,
} from "./ui-lib";
import { copyImageToClipboard } from "../utils/image";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  Path,
  REQUEST_TIMEOUT_MS,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_THEME,
} from "../constant";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { MultimodalContent } from "../client/api";

import { ClientApi } from "../client/api";

import { isEmpty } from "lodash-es";

import clsx from "clsx";

import { ThinkingContent } from "./thinking-content";
import { MessageContentEditPanel } from "./message-content-edit-panel";
import { MessageListEditor } from "./message-list-editor";
import { handleUnauthorizedResponse } from "../utils/auth";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

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
  setUploading: (uploading: boolean) => void;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setUserInput: (input: string) => void;
  setShowChatSidePanel: React.Dispatch<React.SetStateAction<boolean>>;
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
              chatStore.updateTargetSession(session, (session) => {
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
              value={session.title}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.title = e.currentTarget.value),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  chatStore.updateTargetSession(
                    session,
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

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div
      className={styles["delete-image"]}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.deleteImage();
      }}
    >
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
      const currentModel = chatStore.currentSession().model;
      const items = event.clipboardData?.items;
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

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const allModels = chatStore.models;

  // 记住未完成输入的防抖保存函数，间隔放宽到 500ms
  const saveChatInputText = useDebouncedCallback(async (value: string) => {
    try {
      // 双重检查：如果当前输入框已经为空，说明已经发送或清理，不应该保存旧值
      const currentInputValue = inputRef.current?.value ?? "";
      if (value.trim() !== "" && currentInputValue.trim() === "") {
        return;
      }

      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      const newData = {
        ...currentData,
        text: value,
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, newData);
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

  // 保存光标位置（立即保存，无防抖）
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
      const newData = {
        ...currentData,
        selection,
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, newData);
    } catch (e) {
      console.error("[ChatInput][Save] 保存光标位置失败:", e);
    }
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

  // 加载聊天输入数据到组件状态
  const loadChatInputToState = useCallback(async () => {
    // 如果正在从存储加载，避免重复执行
    if (isLoadingFromStorageRef.current) return;

    try {
      isLoadingFromStorageRef.current = true;
      // 直接在这里实现 loadChatInputData 的逻辑，避免依赖问题
      const data = await chatInputStorage.getChatInput(session.id);

      // 无论 data 是否存在，都要安全地设置状态
      // 设置文本内容
      const textContent =
        data?.text && data.text.trim() !== "" ? data.text : "";
      setUserInput(textContent);
      // 使用 setTimeout 确保 DOM 已经渲染
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.value = textContent;
        }
      }, 0);

      // 设置图片
      const imageContent =
        data?.images && data.images.length > 0 ? data.images : [];
      setAttachImages(imageContent);

      // 设置滚动位置和光标位置
      setTimeout(() => {
        if (inputRef.current) {
          // 设置滚动位置
          const scrollTop = data?.scrollTop || 0;
          inputRef.current.scrollTop = scrollTop;

          // 设置光标位置
          const selection = data?.selection || { start: 0, end: 0 };
          inputRef.current.setSelectionRange(selection.start, selection.end);
        }
      }, 0);
    } catch (e) {
      console.error("[ChatInput][Load] 加载聊天输入数据到状态失败:", e);
      // 发生错误时也要清空状态
      setUserInput("");
      setAttachImages([]);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.scrollTop = 0;
          inputRef.current.setSelectionRange(0, 0);
        }
      }, 0);
    } finally {
      isLoadingFromStorageRef.current = false;
    }
  }, [session.id]); // 只依赖 session.id，避免无限循环

  // 会话切换时加载数据
  useEffect(() => {
    loadChatInputToState();
  }, [session.id, loadChatInputToState]);

  // // 自动修正模型配置
  // useEffect(() => {
  //   // 获取当前模型
  //   const model = chatStore.models[0];
  //   // 检查主模型是否有效
  //   const isModelValid = allModels.some((m) => m === model);
  //   // console.log("[updateConfig] isModelValid", isModelValid);
  //   // 如果主模型无效，自动 fetch 并更新为 defaultModel
  //   if (!isModelValid) {
  //     // 拉取服务器配置
  //     chatStore.fetchModels();
  //     // 从 allModels 中获取默认模型
  //     const defaultModel = allModels[0];
  //     if (defaultModel) {
  //       config.update((cfg) => {
  //         // 主模型无效时修正
  //         if (!isModelValid) {
  //           cfg.modelConfig.model = defaultModel;
  //           console.log(
  //             "[updateConfig] cfg.modelConfig.model",
  //             cfg.modelConfig.model,
  //           );
  //         }
  //       });

  //       // 如果当前会话的模型无效且用户没有手动选择模型，则更新会话的模型配置
  //       if (!isModelValid && !session.isModelManuallySelected) {
  //         chatStore.updateTargetSession(session, (session) => {
  //           session.model = defaultModel;
  //           // 标记用户手动选择了模型
  //           session.isModelManuallySelected = true;
  //           console.log("[updateConfig] session.model", session.model);
  //         });
  //       }
  //     }
  //   }
  // }, [accessStore, allModels, session.isModelManuallySelected ?? false]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isLoadingFromStorageRef = useRef(false);

  // 设置全局未授权处理函数
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__handleUnauthorized = () => {
        handleUnauthorizedResponse(navigate);
      };
    }

    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__handleUnauthorized;
      }
    };
  }, [navigate]);

  // 移动端默认开启长输入模式
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      chatStore.updateTargetSession(session, (session) => {
        session.longInputMode = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // onInput 只做本地保存，不 setUserInput
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    saveChatInputText(text); // 只防抖保存 text
    // 立即保存光标位置（无防抖）
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

    // 取消防抖的文本保存，避免延迟保存旧内容
    saveChatInputText.cancel && saveChatInputText.cancel();

    setIsLoading(true);
    chatStore
      .onSendMessage(value, attachImages)
      .then(() => setIsLoading(false));
    setAttachImages([]);

    setUserInput("");
    if (inputRef.current) inputRef.current.value = "";

    // 立即保存空数据到 IndexedDB，避免竞态条件
    const clearChatInput = async () => {
      try {
        const emptyData = {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        };
        await chatInputStorage.saveChatInput(session.id, emptyData);
      } catch (e) {
        console.error("[ChatInput][Clear] 保存空聊天输入数据失败:", e);
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

          // 排除系统消息和已迁移的系统消息
          if (m.content.length === 0 && m.role !== "system") {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // 只有在当前模型无效且用户没有手动选择时才自动更新模型
      const currentModel = session.model;
      const availableModels = chatStore.models;
      const isCurrentModelValid = availableModels.includes(currentModel);

      if (
        !isCurrentModelValid &&
        !session.isModelManuallySelected &&
        availableModels.length > 0
      ) {
        session.model = availableModels[0];
        console.log(
          `[ModelUpdate] 自动更新无效模型 ${currentModel} 到 ${availableModels[0]}`,
        );
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
    if (shouldSubmit(e)) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  const deleteMessage = async (msgId?: string) => {
    chatStore.updateTargetSession(session, (session) => {
      session.messages = session.messages.filter((m) => m.id !== msgId);
      updateSessionStats(session); // 重新计算会话状态
    });
    // 保存删除后的消息到存储
    await chatStore.saveSessionMessages(session);
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
        async onClick() {
          chatStore.updateTargetSession(session, (session) => {
            session.messages = prevMessages;
            updateSessionStats(session); // 重新计算会话状态
          });
          // 撤销删除后也需要保存到存储
          await chatStore.saveSessionMessages(session);
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
      .onSendMessage(textContent, images, requestIndex)
      .then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  // 分支到新会话
  const handleBranch = async (message: ChatMessage, messageIndex: number) => {
    try {
      // 复制会话标题并标注分支
      const originalTopic = session.title || DEFAULT_TOPIC;
      const branchTopic = `${originalTopic} (分支)`;

      // 复制系统提示词
      const systemMessageData = await loadSystemMessageContentFromStorage(
        session.id,
      );

      // 获取完整的消息历史（不受分页限制）
      const fullMessages = session.messages.filter((m) => m.role !== "system");

      // 通过message.id在完整历史中找到真实位置（不依赖分页后的索引）
      const realIndex = fullMessages.findIndex((m) => m.id === message.id);
      if (realIndex === -1) {
        console.error("分支失败：无法在完整历史中找到目标消息", message.id);
        showToast(Locale.Chat.Actions.BranchFailed);
        return;
      }

      // 复制消息历史（包含该消息及之前的所有消息）
      const originalMessages = fullMessages.slice(0, realIndex + 1);

      // 为每条消息重新生成ID，确保唯一性，保持其他属性不变
      const messagesToCopy = originalMessages.map((message) => ({
        ...message,
        id: nanoid(), // 只更新ID，保持其他属性不变
      }));

      // 使用新的branchSession方法，完全避免使用newSession()
      const newSession = await chatStore.branchSession(
        session,
        messagesToCopy,
        systemMessageData,
        branchTopic,
      );

      // 如果有系统提示词，保存到新会话的独立存储
      if (
        systemMessageData.text.trim() ||
        systemMessageData.images.length > 0
      ) {
        // 保存系统消息到新会话的存储
        await saveSystemMessageContentToStorage(
          newSession.id,
          systemMessageData.text,
          systemMessageData.images,
          systemMessageData.scrollTop,
          systemMessageData.selection,
        );

        // 注意：不在 messages 中创建 system 消息，因为系统提示词独立存储
        // prepareMessagesForApi 会在需要时动态加载和合并
      }

      chatStore.selectSession(0);
    } catch (error) {
      console.error("分支会话失败:", error);
      showToast(Locale.Chat.Actions.BranchFailed);
    }
  };

  // 优化点2：渲染消息时彻底过滤 system message
  // 只在渲染时过滤，不影响原始 session.messages
  const filteredSessionMessages = useMemo(() => {
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  const renderMessages = useMemo(() => {
    return filteredSessionMessages;
  }, [filteredSessionMessages]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  // 只在消息数量增加时重置到最后一页（新消息到达）
  const prevMessageLength = useRef(renderMessages.length);
  useEffect(() => {
    if (renderMessages.length > prevMessageLength.current) {
      // 只有消息增加时才重置到最后一页
      const newIndex = Math.max(0, renderMessages.length - CHAT_PAGE_SIZE);
      _setMsgRenderIndex(newIndex);
    }
    prevMessageLength.current = renderMessages.length;
  }, [renderMessages.length]);

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

  const [showPromptModal, setShowPromptModal] = useState(false);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen

  // Handle URL commands - simplified from useCommand logic
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    let shouldUpdate = false;
    searchParams.forEach((param, name) => {
      if (name === "code") {
        console.log("[Command] got code from url: ", param);
        if (param) {
          chatStore.update((chat) => (chat.accessCode = param));
        }
        searchParams.delete(name);
        shouldUpdate = true;
      }
    });

    if (shouldUpdate) {
      setSearchParams(searchParams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

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

  // 检查是否应该自动切换模型的工具函数
  const shouldAutoSwitchModel = (
    systemPromptLength: number,
    isManuallySelected: boolean,
  ) => {
    // 如果用户手动选择了模型，不自动切换
    if (isManuallySelected) {
      console.log("[AutoSwitch] 用户已手动选择模型，跳过自动切换");
      return false;
    }

    // 如果系统提示词长度不超过512字符，不自动切换
    if (systemPromptLength < 512) {
      console.log(
        `[AutoSwitch] 系统提示词长度 ${systemPromptLength} 字符，不需要自动切换`,
      );
      return false;
    }

    // 检查是否存在目标模型
    const targetModel = allModels.find((m) => m === "jyj.cx/pro");
    if (!targetModel) {
      console.log(
        "[AutoSwitch] 目标模型 jyj.cx/pro 不存在或不可用，跳过自动切换",
      );
      return false;
    }

    return true;
  };

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

      // 只保存到独立存储，不在 messages 中创建 system 消息
      if (content.trim() || images.length > 0) {
        saveSystemMessageContentToStorage(
          session.id,
          content.trim(),
          images,
          scrollTop || 0,
          selection || { start: 0, end: 0 },
        );
        // 注意：不在 messages 中创建 system 消息，因为系统提示词独立存储
        // prepareMessagesForApi 会在需要时动态加载和合并
      }

      // 自动切换模型逻辑
      if (!session.isModelManuallySelected) {
        const systemPromptLength = content.trim().length;
        const proModelName = "jyj.cx/pro";
        if (
          shouldAutoSwitchModel(
            systemPromptLength,
            session.isModelManuallySelected ?? false,
          )
        ) {
          // 检查是否存在 jyj.cx/pro 模型
          const targetModel = allModels.find((m) => m === proModelName);
          if (targetModel) {
            const currentModel = session.model;

            // 只有当前模型不是目标模型时才切换
            if (currentModel !== proModelName) {
              session.model = proModelName;
              // 标记用户手动选择了模型
              session.isModelManuallySelected = true;
              console.log(
                `[AutoSwitch] 系统提示词长度 ${systemPromptLength} 字符，自动切换到 jyj.cx/pro 模型`,
              );
            }
          }
        }
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
  interface SystemMetaMessage extends ChatMessage {}

  interface SystemMessageData {
    text: string;
    images: string[];
    scrollTop: number;
    selection: { start: number; end: number };
    updateAt: number;
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
        <div className="window-header">
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
              {!session.title ? DEFAULT_TOPIC : session.title}
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

                  // 总是先尝试从独立存储中加载系统提示词（现在是独立存储的）
                  systemData = await loadSystemMessageContentFromStorage(
                    session.id,
                  );

                  // 如果独立存储中没有数据，且存在旧格式的 system 消息，则从旧格式中解析
                  if (
                    !systemData.text.trim() &&
                    !systemData.images.length &&
                    systemMessage?.content
                  ) {
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
                  await chatStore.deleteSession(chatStore.currentSessionIndex);
                  scrollToBottom();
                }}
              />
            </div>
          </div>
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
                const showActions = !(
                  message.preview || message.content.length === 0
                );
                // Clear context functionality has been removed

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
                                onBranch={handleBranch}
                                index={i}
                              />
                            </div>
                          )}
                        </div>
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
                                loading={
                                  (message.preview || message.streaming) &&
                                  message.content.length === 0 &&
                                  !isUser
                                }
                                onDoubleClickCapture={() => {
                                  if (!isMobileScreen) return;
                                  setUserInput(getMessageTextContent(message));
                                }}
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
                                onBranch={handleBranch}
                                index={i}
                              />
                            </div>
                          )}

                        <div className={styles["chat-message-action-date"]}>
                          {message.date.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <div className={styles["chat-input-panel"]}>
              <ChatActions
                uploadImage={uploadImage}
                capturePhoto={capturePhoto}
                setAttachImages={setAttachImages}
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
                    attachImages.length !== 0,
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
                  onSelect={(e) => {
                    // 光标选择变化时立即保存
                    const selectionStart = e.currentTarget.selectionStart;
                    const selectionEnd = e.currentTarget.selectionEnd;
                    saveChatInputSelection({
                      start: selectionStart,
                      end: selectionEnd,
                    });
                  }}
                  onMouseUp={(e) => {
                    // 鼠标释放时保存光标位置（处理拖拽选择）
                    const selectionStart = e.currentTarget.selectionStart;
                    const selectionEnd = e.currentTarget.selectionEnd;
                    saveChatInputSelection({
                      start: selectionStart,
                      end: selectionEnd,
                    });
                  }}
                  onKeyUp={(e) => {
                    // 键盘释放时保存光标位置（处理键盘导航选择）
                    const selectionStart = e.currentTarget.selectionStart;
                    const selectionEnd = e.currentTarget.selectionEnd;
                    saveChatInputSelection({
                      start: selectionStart,
                      end: selectionEnd,
                    });
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
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showImageModal(image, false); // 使用灯箱展示图片
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault(); // 阻止默认右键菜单
                            copyImageToClipboard(image);
                            e.stopPropagation();
                          }}
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
              const m = session.messages.find(
                (m) => m.id === editMessageData.message.id,
              );
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
            onConfirm={handleConfirm}
          />
        </div>
      </Modal>
    </div>
  );
}
