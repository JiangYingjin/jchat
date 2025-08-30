import React, { useCallback, useEffect, useMemo, useRef } from "react";
import styles from "../styles/chat.module.scss";
import clsx from "clsx";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "./button";
import MonacoEditor from "./monaco-editor";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "./ui-lib";

// 🚀 独立的图片附件组件，优化渲染性能
export const ImageAttachments: React.FC<{
  images: string[];
  onImageDelete: (index: number) => void;
}> = React.memo(({ images, onImageDelete }) => {
  console.log("🖼️ [ImageAttachments] 组件重新渲染:", {
    imagesCount: images.length,
    images: images,
    timestamp: Date.now(),
  });

  if (images.length === 0) return null;

  return (
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
            <DeleteImageButton deleteImage={() => onImageDelete(index)} />
          </div>
        </div>
      ))}
    </div>
  );
});

ImageAttachments.displayName = "ImageAttachments";

interface MonacoMessageEditorProps {
  value: string;
  onChange: (content: string) => void; // 只负责内容变化，不处理图片
  handlePaste?: (event: React.ClipboardEvent<any>) => void; // 使用any类型以支持不同的元素类型
  onConfirm?: () => void;
  onMount?: (editor: any) => void;
  autoFocus?: boolean;
}

export const MonacoMessageEditor: React.FC<MonacoMessageEditorProps> =
  React.memo(
    ({
      value,
      onChange,
      handlePaste,
      onConfirm,
      onMount,
      autoFocus = true,
    }) => {
      // 🚀 性能优化：稳定的内容变化处理函数
      const isInternalUpdateRef = useRef(false); // 标记内部更新
      const lastContentRef = useRef(value || ""); // 存储上一次的内容，避免依赖 value

      // 🎯 同步 lastContentRef 和 props value
      useEffect(() => {
        lastContentRef.current = value || "";
      }, [value]);

      const handleContentChange = useCallback(
        (newContent: string) => {
          const timestamp = performance.now();

          // 🔍 调试：检查防重复调用逻辑的各个条件
          const condition1 = isInternalUpdateRef.current;
          const condition2 = !newContent || newContent.length === 0;
          const condition3 =
            lastContentRef.current && lastContentRef.current.length > 0;
          const shouldIgnore = condition1 && condition2 && condition3;

          // 🛡️ 如果是内部更新导致的onChange，且内容为空，则忽略
          if (shouldIgnore) {
            return;
          }

          // 🎯 准备调用父组件的onChange

          // 🔍 调试：检查父组件onChange函数的调用
          try {
            // Monaco内容变化处理
            onChange(newContent);

            // 🎯 更新最后的内容引用，用于防重复调用逻辑
            lastContentRef.current = newContent || "";
          } catch (error) {
            console.error(
              `❌ [Monaco] 父组件onChange调用失败 [${timestamp.toFixed(2)}ms]:`,
              error,
            );
          }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [onChange, value],
      );

      // 🚀 性能优化：类名缓存（移除图片相关逻辑）
      const panelClassName = useMemo(
        () => monacoStyles["system-prompt-input-panel"],
        [], // 简化类名逻辑，不依赖图片数量
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
            <MonacoEditor
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
          </div>
        </div>
      );
    },
  );

MonacoMessageEditor.displayName = "TextareaMessageEditor";
