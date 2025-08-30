import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { ChatMessage } from "../store";
import { usePasteImageUpload } from "../utils/hooks";
import { Modal } from "./ui-lib";
import { IconButton } from "./button";
import CancelIcon from "../icons/cancel.svg";
import ConfirmIcon from "../icons/confirm.svg";
import { MonacoMessageEditor } from "./monaco-message-editor";

import Locale from "../locales";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";

const SystemPromptEditDialog = React.memo(
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

    // 🎯 稳定的 onChange 回调，避免不必要的重新渲染
    const handleEditorChange = useCallback(
      (newContent: string, newImages: string[]) => {
        console.log("📝 [SystemPromptEditModal] handleEditorChange 被调用:", {
          newContentLength: newContent?.length || 0,
          newImagesCount: newImages?.length || 0,
        });
        setContent(newContent);
        setAttachImages(newImages);
      },
      [], // 空依赖数组，确保函数引用稳定
    );

    // 🔍 在每次渲染时打印当前状态
    console.log("🔄 [SystemPromptEditModal] 组件重新渲染:", {
      contentLength: content?.length || 0,
      contentType: typeof content,
      imagesCount: attachImages?.length || 0,
      uploading,
      renderTimestamp: Date.now(),
    });

    // 🔍 追踪content状态变化
    useEffect(() => {
      console.log("📊 [SystemPromptEditModal] content状态变化:", {
        contentLength: content?.length || 0,
        contentType: typeof content,
        contentPreview: content
          ? content.substring(0, 50) + (content.length > 50 ? "..." : "")
          : "undefined",
        timestamp: Date.now(),
      });
    }, [content]);

    // 🔍 追踪attachImages状态变化
    useEffect(() => {
      console.log("🖼️ [SystemPromptEditModal] attachImages状态变化:", {
        imagesCount: attachImages?.length || 0,
        imagesList: attachImages,
        timestamp: Date.now(),
      });
    }, [attachImages]);

    // 🚀 性能优化：稳定的事件处理函数
    const handleContentChange = useCallback(
      (newContent: string, newImages: string[]) => {
        console.log("🔄 [SystemPromptEditModal] handleContentChange 被调用:", {
          newContentLength: newContent?.length || 0,
          newImagesCount: newImages?.length || 0,
          currentContentLength: content?.length || 0,
          currentImagesCount: attachImages?.length || 0,
          contentChanged: newContent !== content,
          imagesChanged:
            JSON.stringify(newImages) !== JSON.stringify(attachImages),
          pasteInProgress: pasteInProgressRef.current,
          callStack: new Error().stack?.split("\n").slice(1, 4), // 🔍 追踪调用栈
        });

        // 🛡️ 如果正在粘贴过程中，且新内容为空而当前内容不为空，则忽略
        if (
          pasteInProgressRef.current &&
          (!newContent || newContent.length === 0) &&
          content &&
          content.length > 0
        ) {
          console.warn(
            "⚠️ [SystemPromptEditModal] 粘贴过程中检测到空内容更新，忽略以保护现有内容",
            {
              currentContentLength: content.length,
              newContentLength: newContent?.length || 0,
            },
          );
          return;
        }

        console.log("📝 [SystemPromptEditModal] 即将更新状态:", {
          willSetContent: newContent?.length || 0,
          willSetImages: newImages?.length || 0,
        });

        setContent(newContent);
        setAttachImages(newImages);

        // 🔍 验证状态更新（异步）
        setTimeout(() => {
          console.log("⏱️ [SystemPromptEditModal] 状态更新后检查:", {
            actualContentLength: content?.length || 0,
            actualImagesLength: attachImages?.length || 0,
            expectedContentLength: newContent?.length || 0,
            expectedImagesLength: newImages?.length || 0,
          });
        }, 0);
      },
      [content, attachImages],
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

    // 🔥 获取当前Monaco Editor内容的函数
    const getCurrentContent = useCallback(() => {
      if (monacoEditorRef.current) {
        try {
          const currentContent = monacoEditorRef.current.getValue();

          // 🔍 额外调试：检查 Monaco Editor 的内部状态
          try {
            const model = monacoEditorRef.current.getModel();
            if (model) {
              const modelValue = model.getValue();
            } else {
            }
          } catch (modelError) {
            console.error(
              "🎯 [SystemPromptEditModalComponent] DEBUG: 获取 Monaco Model 失败:",
              modelError,
            );
          }

          return currentContent;
        } catch (error) {
          console.error(
            "🎯 [SystemPromptEditModalComponent] DEBUG: Monaco Editor getValue() 调用失败:",
            error,
          );
          return content; // 回退到state中的内容
        }
      }

      console.warn(
        "⚠️ [SystemPromptEditModalComponent] getCurrentContent: Monaco Editor ref 不可用",
      );

      return content; // 回退到state中的内容
    }, [content]);

    // 🔥 专门用于粘贴时保持内容的回调函数
    const pasteInProgressRef = useRef(false); // 防重复调用标志

    const handlePasteContentChange = useCallback(
      (newContent: string) => {
        // 🛡️ 防重复调用：如果正在粘贴过程中且新内容为空，则忽略
        if (
          pasteInProgressRef.current &&
          (!newContent || newContent.length === 0)
        ) {
          console.warn(
            "⚠️ [SystemPromptEditModal] 检测到重复调用，忽略空内容更新",
          );
          return;
        }

        // 只更新内容，保持当前图像不变
        setContent(newContent);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [content, attachImages],
    );

    // 🚀 性能优化：使用自定义 hook 处理粘贴上传图片
    const handlePaste = usePasteImageUpload(
      attachImages,
      setAttachImages,
      setUploading,
      handlePasteContentChange, // 🔥 使用专门的回调函数
      getCurrentContent, // 🔥 传入获取当前内容的函数
    );

    // 🎯 稳定的 handlePaste 回调，避免不必要的重新渲染
    const handlePasteCallback = useCallback(
      (e: React.ClipboardEvent<any>) => {
        console.log("🖼️ [SystemPromptEditModal] handlePaste 触发前状态检查:", {
          currentContentLength: content?.length || 0,
          currentContentType: typeof content,
          currentImagesCount: attachImages?.length || 0,
        });

        // 🔥 设置粘贴进行中标志
        pasteInProgressRef.current = true;
        console.log("🚩 [SystemPromptEditModal] 设置粘贴进行中标志");

        // 执行粘贴处理
        const result = handlePaste(e as any);

        // 🔥 延迟清除粘贴进行中标志，确保所有异步操作完成
        setTimeout(() => {
          pasteInProgressRef.current = false;
          console.log("🏁 [SystemPromptEditModal] 清除粘贴进行中标志");
        }, 1000); // 给足够的时间让异步操作完成

        return result;
      },
      [content, attachImages, handlePaste],
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
          <div className={monacoStyles["system-prompt-edit-container"]}>
            <MonacoMessageEditor
              value={content}
              images={attachImages}
              onChange={handleContentChange}
              handlePaste={handlePasteCallback}
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
SystemPromptEditDialog.displayName = "SystemPromptEditDialog";

// 导出组件
export { SystemPromptEditDialog };

export function MessageWithImageEditDialog(props: {
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
  // 🚀 性能优化：使用自定义 hook 处理粘贴上传图片
  // 注意：此组件使用textarea-based编辑器，不是Monaco Editor
  const handlePaste = usePasteImageUpload(
    attachImages,
    setAttachImages,
    setUploading,
    setContent,
    // 对于textarea-based编辑器，getCurrentContent可以简单地返回当前state
    () => content,
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
          <textarea
            ref={props.textareaRef}
            className={styles["chat-input"]}
            placeholder="请输入消息..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleConfirm();
              }
            }}
            rows={6}
          />
          {/* 图片附件区域 */}
          {attachImages.length > 0 && (
            <div className={styles["attach-images"]}>
              {attachImages.map((image, index) => (
                <div key={index} className={styles["attach-image-item"]}>
                  <img src={image} alt={`attachment-${index}`} />
                  <button
                    className={styles["delete-image"]}
                    onClick={() => {
                      const newImages = attachImages.filter(
                        (_, i) => i !== index,
                      );
                      setAttachImages(newImages);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
