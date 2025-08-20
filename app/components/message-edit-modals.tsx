import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
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
import { MessageContentEditPanelMonaco } from "./message-content-edit-panel-monaco";
import { useTextMemoryMonitor } from "../utils/performance-hooks";
import Locale from "../locales";
import styles from "../styles/chat.module.scss";

const SystemPromptEditModalComponent = React.memo(
  (props: {
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
  }) => {
    const [content, setContent] = useState(props.initialContent);
    const [attachImages, setAttachImages] = useState<string[]>(
      props.initialImages,
    );
    const [uploading, setUploading] = useState(false);
    const [scrollTop, setScrollTop] = useState(props.initialScrollTop || 0);
    const [selection, setSelection] = useState(
      props.initialSelection || { start: 0, end: 0 },
    );

    // 🚀 性能优化：内存监控（Monaco Editor自带性能优化，无需防抖）
    const memoryStatus = useTextMemoryMonitor(content);

    // 🚀 性能优化：稳定的事件处理函数
    const handleContentChange = useCallback(
      (newContent: string, newImages: string[]) => {
        // 调试信息已移除，Monaco Editor内容同步正常
        setContent(newContent);
        setAttachImages(newImages);
      },
      [],
    );

    // Monaco Editor实例引用
    const monacoEditorRef = useRef<any>(null);

    // 保存Monaco Editor实例
    const handleMonacoMount = useCallback(
      (editor: any) => {
        monacoEditorRef.current = editor;

        // 恢复滚动位置和光标位置
        if (scrollTop > 0) {
          editor.setScrollTop(scrollTop);
        }

        if (selection.start > 0 || selection.end > 0) {
          const model = editor.getModel();
          if (model) {
            const startPos = model.getPositionAt(selection.start);
            const endPos = model.getPositionAt(selection.end);
            editor.setSelection({
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            });
          }
        }
      },
      [scrollTop, selection],
    );

    // 🚀 性能优化：使用自定义 hook 处理粘贴上传图片
    const handlePaste = usePasteImageUpload(
      attachImages,
      setAttachImages,
      setUploading,
      setContent,
    );

    // 🚀 性能优化：保存处理函数缓存
    const handleSave = useCallback(() => {
      let currentScrollTop = 0;
      let currentSelectionStart = 0;
      let currentSelectionEnd = 0;
      let currentContent = content; // 默认使用state中的内容

      // 从Monaco Editor获取当前状态和最新内容
      if (monacoEditorRef.current) {
        try {
          // 🔥 关键修复：从Monaco Editor获取最新内容
          currentContent = monacoEditorRef.current.getValue() || "";

          currentScrollTop = monacoEditorRef.current.getScrollTop() || 0;

          const selection = monacoEditorRef.current.getSelection();
          if (selection) {
            const model = monacoEditorRef.current.getModel();
            if (model) {
              currentSelectionStart = model.getOffsetAt({
                lineNumber: selection.startLineNumber,
                column: selection.startColumn,
              });
              currentSelectionEnd = model.getOffsetAt({
                lineNumber: selection.endLineNumber,
                column: selection.endColumn,
              });
            }
          }
        } catch (error) {
          console.warn("Failed to get Monaco Editor state:", error);
        }
      }

      // 从Monaco Editor获取最新内容确保保存正确

      props.onSave(currentContent.trim(), attachImages, currentScrollTop, {
        start: currentSelectionStart,
        end: currentSelectionEnd,
      });
      props.onClose();
    }, [content, attachImages, props]);

    // 🚀 性能优化：取消处理函数缓存
    const handleCancel = useCallback(() => {
      props.onClose();
    }, [props]);

    // 🚀 性能优化：按钮配置缓存
    const modalActions = useMemo(
      () => [
        <IconButton
          text={Locale.UI.Cancel}
          icon={<CancelIcon />}
          key="cancel"
          onClick={handleCancel}
        />,
        <IconButton
          type="primary"
          text={Locale.UI.Confirm}
          icon={<ConfirmIcon />}
          key="ok"
          onClick={handleSave}
        />,
      ],
      [handleCancel, handleSave],
    );

    return (
      <div className="modal-mask">
        <Modal
          title="编辑系统提示词"
          onClose={handleCancel}
          actions={modalActions}
        >
          <div className={styles["system-prompt-edit-container"]}>
            {/* 🚀 性能状态指示器 */}
            {memoryStatus.level !== "normal" && (
              <div className={styles["performance-status"]}>
                {memoryStatus.level === "warning" && (
                  <div className={styles["memory-warning"]}>
                    ⚠️ {memoryStatus.message}
                    {memoryStatus.suggestions && (
                      <ul>
                        {memoryStatus.suggestions.map((suggestion, idx) => (
                          <li key={idx}>{suggestion}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {memoryStatus.level === "critical" && (
                  <div className={styles["memory-critical"]}>
                    🚨 {memoryStatus.message}
                    {memoryStatus.suggestions && (
                      <ul>
                        {memoryStatus.suggestions.map((suggestion, idx) => (
                          <li key={idx}>{suggestion}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <MessageContentEditPanelMonaco
              value={content}
              images={attachImages}
              onChange={handleContentChange}
              handlePaste={(e) => handlePaste(e as any)}
              onConfirm={handleSave}
              onMount={handleMonacoMount}
            />
          </div>
        </Modal>
      </div>
    );
  },
);

// 设置显示名称
SystemPromptEditModalComponent.displayName = "SystemPromptEditModal";

// 导出组件
export const SystemPromptEditModal = SystemPromptEditModalComponent;

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
            onChange={(newContent: string, newImages: string[]) => {
              setContent(newContent);
              setAttachImages(newImages);
            }}
            textareaRef={props.textareaRef}
            handlePaste={handlePaste}
            onConfirm={handleConfirm}
          />
        </div>
      </Modal>
    </div>
  );
}
