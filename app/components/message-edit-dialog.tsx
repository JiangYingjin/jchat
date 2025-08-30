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

// 🎯 编辑器类型枚举 - 统一使用 Monaco Editor
export enum EditorType {
  MONACO = "monaco",
}

// 🎯 编辑器配置接口
export interface EditorConfig {
  type: EditorType;
  placeholder?: string;
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
  // Monaco Editor容器引用（兼容性）
  textareaRef?: React.RefObject<HTMLElement>;
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

  // 🎯 获取当前 Monaco Editor 内容
  const getCurrentContent = useCallback(() => {
    if (monacoEditorRef.current) {
      try {
        const currentContent = monacoEditorRef.current.getValue();
        return currentContent || "";
      } catch (error) {
        console.warn("Failed to get Monaco Editor content:", error);
        return content;
      }
    }
    return content;
  }, [content]);

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

  // 🎯 粘贴处理 - 专为 Monaco Editor 设计
  const handlePaste = usePasteImageUpload(
    attachImages,
    setAttachImages,
    setUploading,
    handlePasteContentChange,
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

          // 聚焦到编辑器并滚动到选中文本位置
          editor.focus();
          setTimeout(() => {
            editor.revealRangeInCenter({
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            });
          }, 100);
        }
      } else {
        // 如果没有指定选择位置，默认聚焦到编辑器末尾
        const model = editor.getModel();
        if (model && editorConfig.autoFocus !== false) {
          const lineCount = model.getLineCount();
          const lastLineContent = model.getLineContent(lineCount);
          const endPos = {
            lineNumber: lineCount,
            column: lastLineContent.length + 1,
          };
          editor.setPosition(endPos);
          editor.focus();
        }
      }

      // 调用外部传入的onMount回调
      monacoConfig?.onMount?.(editor);
    },
    [monacoConfig, editorConfig.autoFocus],
  );

  // 🎯 保存处理
  const handleSave = useCallback(
    (retryOnConfirm = false) => {
      let currentContent = content;
      let scrollTop = 0;
      let selection = { start: 0, end: 0 };

      // 从Monaco Editor获取最新状态
      if (monacoEditorRef.current) {
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

      // 保存逻辑 - 统一使用 Monaco Editor 的参数格式
      saveConfig.onSave(
        currentContent.trim(),
        attachImages,
        scrollTop,
        selection,
      );

      // 保存完成后关闭模态框
      saveConfig.onCancel();
    },
    [content, attachImages, saveConfig],
  );

  // 🎯 快捷键处理 - Monaco Editor 已内置支持 Ctrl+Enter

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

  // 🎯 渲染 Monaco Editor
  const renderEditor = () => (
    <MonacoMessageEditor
      value={editor.content}
      onChange={editor.handleEditorContentChange}
      handlePaste={editor.handlePasteCallback}
      onConfirm={() => editor.handleSave(false)}
      onMount={editor.handleMonacoMount}
      autoFocus={editorConfig.autoFocus}
    />
  );

  // 🎯 渲染图片附件
  const renderImageAttachments = () => {
    if (!imageConfig.showImages || editor.attachImages.length === 0) {
      return null;
    }

    return (
      <ImageAttachments
        images={editor.attachImages}
        onImageDelete={editor.handleImageDelete}
      />
    );
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
        <div className={monacoStyles["system-prompt-edit-container"]}>
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
    textareaRef?: React.RefObject<HTMLElement>;
    message?: ChatMessage;

    // Monaco特有的配置
    monacoConfig?: {
      scrollTop?: number;
      selection?: { start: number; end: number };
    };
  }) => {
    const { title = "编辑消息", textareaRef, monacoConfig } = props;

    const editorConfig: EditorConfig = {
      type: EditorType.MONACO,
      placeholder: "请输入消息...",
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
  textareaRef?: React.RefObject<HTMLElement>;
  message?: ChatMessage;
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
    />
  );
}
