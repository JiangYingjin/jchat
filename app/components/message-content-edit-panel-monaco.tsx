import React, { useCallback, useMemo } from "react";
import clsx from "clsx";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "./button";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "./ui-lib";
import MonacoSystemPromptEditor from "./monaco-system-prompt-editor";

interface MessageContentEditPanelMonacoProps {
  value: string;
  images: string[];
  onChange: (content: string, images: string[]) => void;
  handlePaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onConfirm?: () => void;
  onMount?: (editor: any) => void;
  autoFocus?: boolean;
}

export const MessageContentEditPanelMonaco: React.FC<MessageContentEditPanelMonacoProps> =
  React.memo(
    ({
      value,
      images,
      onChange,
      handlePaste,
      onConfirm,
      onMount,
      autoFocus = true,
    }) => {
      // 🚀 性能优化：稳定的内容变化处理函数
      const handleContentChange = useCallback(
        (newContent: string) => {
          // Monaco内容变化处理
          onChange(newContent, images);
        },
        [onChange, images],
      );

      // 🚀 性能优化：图片删除处理函数缓存
      const imageDeleteHandlers = useMemo(() => {
        return images.map((_, index) => () => {
          const newImages = images.filter((_, i) => i !== index);
          onChange(value, newImages);
        });
      }, [images, onChange, value]);

      // 🚀 性能优化：类名缓存
      const panelClassName = useMemo(
        () =>
          clsx(styles["system-prompt-input-panel"], {
            [styles["system-prompt-input-panel-attach"]]: images.length !== 0,
          }),
        [images.length],
      );

      // 🚀 Monaco Editor挂载回调
      const handleMonacoMount = useCallback(
        async (editor: any) => {
          try {
            // 动态导入monaco以获取KeyMod和KeyCode
            const monaco = await import("monaco-editor");

            // 配置快捷键
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
              () => {
                onConfirm?.();
              },
            );

            // 处理粘贴事件（如果需要图片上传）
            if (handlePaste) {
              const container = editor.getDomNode();
              if (container) {
                container.addEventListener("paste", (e: ClipboardEvent) => {
                  // 简化事件处理，直接传递原生事件的必要信息
                  handlePaste({
                    clipboardData: e.clipboardData,
                    preventDefault: () => e.preventDefault(),
                    stopPropagation: () => e.stopPropagation(),
                  } as any);
                });
              }
            }

            // 调用外部传入的onMount回调
            onMount?.(editor);
          } catch (error) {
            console.warn("Failed to configure Monaco Editor shortcuts:", error);
          }
        },
        [onConfirm, handlePaste, onMount],
      );

      return (
        <div className={panelClassName}>
          {/* 🚀 Monaco Editor 编辑器 */}
          <div className={styles["monaco-wrapper"]}>
            <MonacoSystemPromptEditor
              value={value}
              onChange={handleContentChange}
              onMount={handleMonacoMount}
              autoFocus={autoFocus}
              placeholder="请输入系统提示词...支持大文本编辑和语法高亮"
              className={styles["system-prompt-monaco"]}
            />
          </div>

          {/* 🚀 图片附件区域 */}
          {images.length !== 0 && (
            <div className={monacoStyles["monaco-images-container"]}>
              {images.map((image, index) => (
                <div
                  key={index}
                  className={monacoStyles["monaco-image-item"]}
                  style={{ backgroundImage: `url("${image}")` }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showImageModal(image, false);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    copyImageToClipboard(image);
                  }}
                >
                  <div className={monacoStyles["monaco-image-mask"]}>
                    <DeleteImageButton
                      deleteImage={imageDeleteHandlers[index]}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
  );

MessageContentEditPanelMonaco.displayName = "MessageContentEditPanelMonaco";
