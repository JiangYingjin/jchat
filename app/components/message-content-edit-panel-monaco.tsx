import React, { useCallback, useMemo, useRef } from "react";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "./button";
import MonacoSystemPromptEditor from "./monaco-system-prompt-editor";
import { useImageManagement } from "../hooks/use-image-management";

interface MessageContentEditPanelMonacoProps {
  value: string;
  images: string[];
  onChange: (content: string, images: string[]) => void;
  handlePaste?: (event: React.ClipboardEvent<any>) => void; // 使用any类型以支持不同的元素类型
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
      const isInternalUpdateRef = useRef(false); // 标记内部更新

      const handleContentChange = useCallback(
        (newContent: string) => {
          console.log("📝 [Monaco] handleContentChange 被调用:", {
            newContentLength: newContent?.length || 0,
            currentValueLength: value?.length || 0,
            imagesCount: images?.length || 0,
            contentChanged: newContent !== value,
            isInternalUpdate: isInternalUpdateRef.current,
            callStack: new Error().stack?.split("\n").slice(1, 5), // 🔍 追踪调用栈
          });

          // 🛡️ 如果是内部更新导致的onChange，且内容为空，则忽略
          if (
            isInternalUpdateRef.current &&
            (!newContent || newContent.length === 0) &&
            value &&
            value.length > 0
          ) {
            console.warn(
              "⚠️ [Monaco] 检测到内部更新导致的空内容onChange，忽略以避免内容丢失",
            );
            return;
          }

          // Monaco内容变化处理
          onChange(newContent, images);
        },
        [onChange, images, value],
      );

      // 🚀 使用图片管理 hook
      const {
        imageDeleteHandlers,
        panelClassName,
        handleImageClick,
        handleImageContextMenu,
      } = useImageManagement({
        images,
        value,
        onChange,
      });

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

            // 🚀 早期拦截粘贴事件 - 在Monaco处理之前捕获图片
            if (handlePaste) {
              const container = editor.getDomNode();
              if (container) {
                // 🔥 关键：使用capture=true在捕获阶段拦截，优先级最高
                const earlyPasteHandler = (e: ClipboardEvent) => {
                  if (e.clipboardData) {
                    // 检查图像数据
                    let hasImage = false;
                    const imageFiles: File[] = [];

                    // 通过items检查
                    if (
                      e.clipboardData.items &&
                      e.clipboardData.items.length > 0
                    ) {
                      for (let i = 0; i < e.clipboardData.items.length; i++) {
                        const item = e.clipboardData.items[i];
                        if (
                          item.kind === "file" &&
                          item.type.startsWith("image/")
                        ) {
                          hasImage = true;
                          const file = item.getAsFile();
                          if (file) {
                            imageFiles.push(file);
                          }
                        }
                      }
                    }

                    // 通过files检查（备用）
                    if (
                      e.clipboardData.files &&
                      e.clipboardData.files.length > 0
                    ) {
                      for (let i = 0; i < e.clipboardData.files.length; i++) {
                        const file = e.clipboardData.files[i];
                        if (file.type.startsWith("image/")) {
                          hasImage = true;
                          imageFiles.push(file);
                        }
                      }
                    }

                    // 如果检测到图像，立即处理
                    if (hasImage && imageFiles.length > 0) {
                      // 阻止Monaco的默认处理，让我们接管
                      e.preventDefault();
                      e.stopPropagation();

                      // 创建React兼容的事件对象
                      const reactClipboardEvent = {
                        clipboardData: e.clipboardData,
                        preventDefault: () => e.preventDefault(),
                        stopPropagation: () => e.stopPropagation(),
                        currentTarget: container as any,
                        target: e.target,
                        type: "paste",
                        nativeEvent: e,
                        bubbles: e.bubbles,
                        cancelable: e.cancelable,
                        defaultPrevented: e.defaultPrevented,
                        eventPhase: e.eventPhase,
                        isTrusted: e.isTrusted,
                        timeStamp: e.timeStamp,
                      } as React.ClipboardEvent<any>;

                      // 处理图片
                      try {
                        handlePaste(reactClipboardEvent);
                      } catch (error) {
                        console.error("图片粘贴处理失败:", error);
                      }
                    }
                  }
                };

                // 🎯 在捕获阶段监听，优先级最高
                container.addEventListener("paste", earlyPasteHandler, {
                  capture: true,
                });

                // 备用：也在Monaco的父容器上监听
                const parent = container.parentElement;
                if (parent) {
                  parent.addEventListener("paste", earlyPasteHandler, {
                    capture: true,
                  });
                }

                // 备用：document级别监听（最后的保险）
                const documentHandler = (e: ClipboardEvent) => {
                  if (container.contains(e.target as Node)) {
                    earlyPasteHandler(e);
                  }
                };
                document.addEventListener("paste", documentHandler, {
                  capture: true,
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
          <div className={monacoStyles["monaco-wrapper"]}>
            <MonacoSystemPromptEditor
              value={value}
              onChange={handleContentChange}
              onMount={(editor) => {
                handleMonacoMount(editor);
                // 保障首次可见后进行一次布局，避免容器初始高度为0时内容未铺满
                setTimeout(() => {
                  try {
                    editor.layout();
                  } catch {}
                }, 0);
              }}
              autoFocus={autoFocus}
              className=""
            />

            {/* 🚀 图片附件区域 */}
            {images.length !== 0 && (
              <div className={monacoStyles["monaco-images-container"]}>
                {images.map((image, index) => (
                  <div
                    key={index}
                    className={monacoStyles["monaco-image-item"]}
                    style={{ backgroundImage: `url("${image}")` }}
                    onClick={handleImageClick(image)}
                    onContextMenu={handleImageContextMenu(image)}
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
        </div>
      );
    },
  );

MessageContentEditPanelMonaco.displayName = "MessageContentEditPanelMonaco";
