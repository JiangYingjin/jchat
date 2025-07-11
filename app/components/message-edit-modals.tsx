import React, { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../store";
import { usePasteImageUpload } from "../utils/hooks";
import {
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
} from "../utils";
import { Modal } from "./ui-lib";
import { IconButton } from "./button";
import CancelIcon from "../icons/cancel.svg";
import ConfirmIcon from "../icons/confirm.svg";
import { MessageContentEditPanel } from "./message-content-edit-panel";
import Locale from "../locales";
import styles from "./chat.module.scss";

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
