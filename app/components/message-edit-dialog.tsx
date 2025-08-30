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
import { MonacoMessageEditor, ImageAttachments } from "./monaco-message-editor";
import Locale from "../locales";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";

// 🎯 编辑器类型枚举
export enum EditorType {
  MONACO = "monaco",
  TEXTAREA = "textarea",
}

// 🎯 编辑器配置接口
export interface EditorConfig {
  type: EditorType;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}

// 🎯 图片附件管理接口
export interface ImageAttachmentConfig {
  images: string[];
  onImageDelete: (index: number) => void;
  showImages?: boolean;
}

// 🎯 保存配置接口
export interface SaveConfig {
  enableRetryOnConfirm?: boolean; // 是否支持Ctrl+Enter保存并重试
  onSave: (content: string, images: string[], ...args: any[]) => void;
  onCancel: () => void;
}

// 🎯 完整的编辑器props接口
export interface EditorCoreProps {
  initialContent: string;
  initialImages: string[];
  editorConfig: EditorConfig;
  imageConfig: ImageAttachmentConfig;
  saveConfig: SaveConfig;
  modalConfig: {
    title: string;
    onClose: () => void;
  };
  // Monaco特有的配置
  monacoConfig?: {
    onMount?: (editor: any) => void;
    scrollTop?: number;
    selection?: { start: number; end: number };
  };
  // Textarea特有的配置
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

// 🎯 通用的消息编辑器hook
export function useMessageEditor(props: EditorCoreProps) {
  const {
    initialContent,
    initialImages,
    editorConfig,
    saveConfig,
    monacoConfig,
    textareaRef,
  } = props;

  // 🎯 状态管理
  const [content, setContent] = useState(initialContent);
  const [attachImages, setAttachImages] = useState<string[]>(initialImages);
  const [uploading, setUploading] = useState(false);

  // Monaco Editor实例引用
  const monacoEditorRef = useRef<any>(null);
  // 粘贴进度追踪
  const pasteInProgressRef = useRef(false);

  // 🎯 图片删除处理
  const handleImageDelete = useCallback(
    (index: number) => {
      const newImages = attachImages.filter((_, i) => i !== index);
      setAttachImages(newImages);
    },
    [attachImages],
  );

  // 🎯 获取当前内容（支持Monaco Editor）
  const getCurrentContent = useCallback(() => {
    if (editorConfig.type === EditorType.MONACO && monacoEditorRef.current) {
      try {
        const currentContent = monacoEditorRef.current.getValue();
        return currentContent || "";
      } catch (error) {
        console.warn("Failed to get Monaco Editor content:", error);
        return content;
      }
    }
    return content;
  }, [content, editorConfig.type]);

  // 🎯 处理粘贴时内容变化（Monaco专用）
  const handlePasteContentChange = useCallback((newContent: string) => {
    // 如果正在粘贴过程中且新内容为空，则忽略（防止重复调用）
    if (
      pasteInProgressRef.current &&
      (!newContent || newContent.length === 0)
    ) {
      return;
    }
    setContent(newContent);
  }, []);

  // 🎯 粘贴处理
  const handlePaste = usePasteImageUpload(
    attachImages,
    setAttachImages,
    setUploading,
    // 对于Monaco Editor，使用专门的回调；对于Textarea，使用setContent
    editorConfig.type === EditorType.MONACO
      ? handlePasteContentChange
      : setContent,
    getCurrentContent,
  );

  // 🎯 编辑器内容变化处理
  const handleEditorContentChange = useCallback(
    (newContent: string, newImages?: string[]) => {
      if (newImages) {
        // 同时更新内容和图片（用于图片粘贴）
        setContent(newContent);
        setAttachImages(newImages);
      } else {
        // 只更新内容
        setContent(newContent);
      }
    },
    [],
  );

  // 🎯 Monaco Editor挂载处理
  const handleMonacoMount = useCallback(
    (editor: any) => {
      monacoEditorRef.current = editor;

      // 恢复滚动位置和光标位置
      if (monacoConfig?.scrollTop && monacoConfig.scrollTop > 0) {
        editor.setScrollTop(monacoConfig.scrollTop);
      }

      if (
        monacoConfig?.selection &&
        (monacoConfig.selection.start > 0 || monacoConfig.selection.end > 0)
      ) {
        const model = editor.getModel();
        if (model) {
          const startPos = model.getPositionAt(monacoConfig.selection.start);
          const endPos = model.getPositionAt(monacoConfig.selection.end);
          editor.setSelection({
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          });
        }
      }

      // 调用外部传入的onMount回调
      monacoConfig?.onMount?.(editor);
    },
    [monacoConfig],
  );

  // 🎯 保存处理
  const handleSave = useCallback(
    (retryOnConfirm = false) => {
      let currentContent = content;
      let scrollTop = 0;
      let selection = { start: 0, end: 0 };

      // 从Monaco Editor获取最新状态
      if (editorConfig.type === EditorType.MONACO && monacoEditorRef.current) {
        try {
          currentContent = monacoEditorRef.current.getValue() || "";
          scrollTop = monacoEditorRef.current.getScrollTop() || 0;

          const editorSelection = monacoEditorRef.current.getSelection();
          if (editorSelection) {
            const model = monacoEditorRef.current.getModel();
            if (model) {
              selection.start = model.getOffsetAt({
                lineNumber: editorSelection.startLineNumber,
                column: editorSelection.startColumn,
              });
              selection.end = model.getOffsetAt({
                lineNumber: editorSelection.endLineNumber,
                column: editorSelection.endColumn,
              });
            }
          }
        } catch (error) {
          console.warn("Failed to get Monaco Editor state:", error);
        }
      }

      // 根据编辑器类型调用不同的保存逻辑
      if (editorConfig.type === EditorType.MONACO) {
        // 系统提示词保存，需要scrollTop和selection
        saveConfig.onSave(
          currentContent.trim(),
          attachImages,
          scrollTop,
          selection,
        );
      } else {
        // 消息编辑保存，支持retryOnConfirm
        saveConfig.onSave(currentContent.trim(), attachImages, retryOnConfirm);
      }

      // 保存完成后关闭模态框
      saveConfig.onCancel();
    },
    [content, attachImages, editorConfig.type, saveConfig],
  );

  // 🎯 快捷键处理 (Textarea模式)
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        saveConfig.enableRetryOnConfirm &&
        e.key === "Enter" &&
        (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        handleSave(true); // 保存并重试
      }
    },
    [saveConfig.enableRetryOnConfirm, handleSave],
  );

  // 🎯 处理粘贴回调（Monaco专用）
  const handlePasteCallback = useCallback(
    (e: React.ClipboardEvent<any>) => {
      pasteInProgressRef.current = true;

      const result = handlePaste(e as any);

      // 延迟清除粘贴标志
      setTimeout(() => {
        pasteInProgressRef.current = false;
      }, 1000);

      return result;
    },
    [handlePaste],
  );

  // 🎯 返回统一的接口
  return {
    // 状态
    content,
    attachImages,
    uploading,

    // 处理函数
    handleImageDelete,
    handleEditorContentChange,
    handleMonacoMount,
    handleSave,
    handleTextareaKeyDown,
    handlePaste,
    handlePasteCallback,

    // 编辑器引用
    monacoEditorRef,

    // 编辑器配置
    editorConfig,
    textareaRef,
  };
}

// 🎯 通用的编辑器核心组件
export const EditorCore: React.FC<EditorCoreProps> = React.memo((props) => {
  const { editorConfig, imageConfig, modalConfig, textareaRef, saveConfig } =
    props;

  const editor = useMessageEditor(props);

  // 🎯 渲染不同的编辑器
  const renderEditor = () => {
    if (editorConfig.type === EditorType.MONACO) {
      return (
        <MonacoMessageEditor
          value={editor.content}
          onChange={editor.handleEditorContentChange}
          handlePaste={editor.handlePasteCallback}
          onConfirm={() => editor.handleSave(false)}
          onMount={editor.handleMonacoMount}
          autoFocus={editorConfig.autoFocus}
        />
      );
    }

    if (editorConfig.type === EditorType.TEXTAREA) {
      return (
        <textarea
          ref={textareaRef}
          className={styles["chat-input"]}
          placeholder={editorConfig.placeholder || "请输入消息..."}
          value={editor.content}
          onChange={(e) => editor.handleEditorContentChange(e.target.value)}
          onPaste={editor.handlePaste}
          onKeyDown={editor.handleTextareaKeyDown}
          rows={editorConfig.rows || 6}
        />
      );
    }

    return null;
  };

  // 🎯 渲染图片附件
  const renderImageAttachments = () => {
    if (!imageConfig.showImages || editor.attachImages.length === 0) {
      return null;
    }

    if (editorConfig.type === EditorType.MONACO) {
      return (
        <ImageAttachments
          images={editor.attachImages}
          onImageDelete={editor.handleImageDelete}
        />
      );
    }

    if (editorConfig.type === EditorType.TEXTAREA) {
      return (
        <div className={styles["attach-images"]}>
          {editor.attachImages.map((image, index) => (
            <div key={index} className={styles["attach-image-item"]}>
              <img src={image} alt={`attachment-${index}`} />
              <button
                className={styles["delete-image"]}
                onClick={() => editor.handleImageDelete(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  // 🎯 模态框动作按钮
  const modalActions = useMemo(
    () => [
      <IconButton
        text={Locale.UI.Cancel}
        icon={<CancelIcon />}
        key="cancel"
        onClick={modalConfig.onClose}
      />,
      <IconButton
        type="primary"
        text={Locale.UI.Confirm}
        icon={<ConfirmIcon />}
        key="ok"
        onClick={() => editor.handleSave(false)}
      />,
    ],
    [modalConfig.onClose, editor],
  );

  return (
    <div className="modal-mask">
      <Modal
        title={modalConfig.title}
        onClose={modalConfig.onClose}
        actions={modalActions}
      >
        <div
          className={
            editorConfig.type === EditorType.MONACO
              ? monacoStyles["system-prompt-edit-container"]
              : styles["system-prompt-edit-container"]
          }
        >
          {renderEditor()}
          {renderImageAttachments()}
        </div>
      </Modal>
    </div>
  );
});

EditorCore.displayName = "EditorCore";

// 🎯 重构后的系统提示词编辑器 - 使用通用EditorCore
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
    return (
      <EditorCore
        initialContent={props.initialContent}
        initialImages={props.initialImages}
        editorConfig={{
          type: EditorType.MONACO,
          placeholder: "请输入系统提示词...",
          autoFocus: true,
        }}
        imageConfig={{
          images: props.initialImages,
          onImageDelete: () => {}, // 图片删除由内部处理
          showImages: true,
        }}
        saveConfig={{
          enableRetryOnConfirm: false, // 系统提示词不需要重试功能
          onSave: props.onSave,
          onCancel: props.onClose,
        }}
        modalConfig={{
          title: "编辑系统提示词",
          onClose: props.onClose,
        }}
        monacoConfig={{
          scrollTop: props.initialScrollTop,
          selection: props.initialSelection,
        }}
      />
    );
  },
);

// 🎯 重构后的消息编辑器 - 支持Monaco Editor
const MessageEditDialog = React.memo(
  (props: {
    onClose: () => void;
    initialContent: string;
    initialImages: string[];
    onSave: (
      content: string,
      images: string[],
      retryOnConfirm?: boolean,
    ) => void;
    title?: string;
    textareaRef?: React.RefObject<HTMLTextAreaElement>;
    message?: ChatMessage;
    // 新增：编辑器类型选择
    preferredEditorType?: EditorType;
    // Monaco特有的配置
    monacoConfig?: {
      scrollTop?: number;
      selection?: { start: number; end: number };
    };
  }) => {
    const {
      title = "编辑消息",
      textareaRef,
      preferredEditorType = EditorType.TEXTAREA,
      monacoConfig,
    } = props;

    // 根据内容长度智能选择编辑器类型
    const editorType = React.useMemo(() => {
      // 如果明确指定了类型，使用指定类型
      if (preferredEditorType !== undefined) {
        return preferredEditorType;
      }

      // 智能选择：长文本使用Monaco，短文本使用Textarea
      const contentLength = props.initialContent.length;
      const hasLineBreaks = props.initialContent.includes("\n");

      // 内容较长或包含换行符时使用Monaco Editor
      if (
        contentLength > 500 ||
        hasLineBreaks ||
        props.initialImages.length > 0
      ) {
        return EditorType.MONACO;
      }

      return EditorType.TEXTAREA;
    }, [preferredEditorType, props.initialContent, props.initialImages.length]);

    const editorConfig: EditorConfig = {
      type: editorType,
      placeholder: "请输入消息...",
      rows: 6,
      autoFocus: true,
    };

    return (
      <EditorCore
        initialContent={props.initialContent}
        initialImages={props.initialImages}
        editorConfig={editorConfig}
        imageConfig={{
          images: props.initialImages,
          onImageDelete: () => {}, // 图片删除由内部处理
          showImages: true,
        }}
        saveConfig={{
          enableRetryOnConfirm: true, // 消息编辑支持重试功能
          onSave: props.onSave,
          onCancel: props.onClose,
        }}
        modalConfig={{
          title,
          onClose: props.onClose,
        }}
        textareaRef={textareaRef}
        monacoConfig={monacoConfig}
      />
    );
  },
);

MessageEditDialog.displayName = "MessageEditDialog";

// 设置显示名称
SystemPromptEditDialog.displayName = "SystemPromptEditDialog";

// 导出组件
export { SystemPromptEditDialog, MessageEditDialog };

// 🎯 兼容性包装器 - 保持向后兼容性
export function MessageWithImageEditDialog(props: {
  onClose: () => void;
  initialContent: string;
  initialImages: string[];
  onSave: (content: string, images: string[], retryOnConfirm?: boolean) => void;
  title?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  message?: ChatMessage;
  // 新增：支持编辑器类型选择
  preferredEditorType?: EditorType;
}) {
  return (
    <MessageEditDialog
      onClose={props.onClose}
      initialContent={props.initialContent}
      initialImages={props.initialImages}
      onSave={props.onSave}
      title={props.title}
      textareaRef={props.textareaRef}
      message={props.message}
      preferredEditorType={props.preferredEditorType}
    />
  );
}
