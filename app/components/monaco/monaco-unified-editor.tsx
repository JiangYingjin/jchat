import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useLayoutEffect,
} from "react";

import styles from "../../styles/chat.module.scss";
import clsx from "clsx";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import monacoStyles from "../../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "../button";
import { copyImageToClipboard } from "../../utils/image";
import { showImageModal } from "../ui-lib";

// 导入抽分出的模块
import {
  loadMonaco,
  PERFORMANCE_OPTIONS,
  MiddleClickScrollSystem,
  KeyboardHandler,
  StatsBar,
  ErrorDisplay,
  LoadingIndicator,
  updateStats,
  safeTextValue,
  isComponentMounted,
  safeFocusEditor,
  delay,
} from ".";

/**
 * 统一的 Monaco 编辑器组件
 * 合并了 MonacoEditor 和 MonacoMessageEditor 的功能
 * 支持基础编辑器模式和消息编辑器模式
 */

// 图片附件组件（内联到主组件中）
const ImageAttachments: React.FC<{
  images: string[];
  onImageDelete: (index: number) => void;
}> = React.memo(({ images, onImageDelete }) => {
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

// 统一组件的 Props 接口
interface MonacoUnifiedEditorProps {
  // 基础编辑器属性
  value: string;
  onChange: (value: string) => void;
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;

  // 消息编辑器特定属性
  images?: string[]; // 图片附件
  onImageDelete?: (index: number) => void; // 图片删除回调
  handlePaste?: (event: React.ClipboardEvent<any>) => void; // 粘贴处理
  onConfirm?: () => void; // 确认回调（Ctrl+Enter）
  onMount?: (editor: any) => void; // 挂载回调
}

/**
 * 统一的 Monaco 编辑器组件
 * 集成了消息编辑器的所有功能
 */
export const MonacoUnifiedEditor: React.FC<MonacoUnifiedEditorProps> = ({
  value,
  onChange,
  onEditorReady,
  className,
  readOnly = false,
  autoFocus = true,
  images = [],
  onImageDelete,
  handlePaste,
  onConfirm,
  onMount,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const disposableRef = useRef<any>(null);
  const disposablesRef = useRef<(() => void)[]>([]); // 用于存储所有需要清理的资源
  const isDisposedRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initIdRef = useRef(0);
  const isReadyRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ characters: 0, lines: 0, words: 0 });

  // 防抖更新统计信息，避免频繁重渲染
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSetStats = useCallback(
    (newStats: { characters: number; lines: number; words: number }) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        setStats(newStats);
      }, 50); // 50ms 防抖
    },
    [],
  );
  const [monacoLoadMethod, setMonacoLoadMethod] = useState<
    "preloaded" | "loading" | "fallback"
  >("fallback");

  // 消息编辑器特定的状态
  const isInternalUpdateRef = useRef(false);
  const lastContentRef = useRef(value || "");
  const editorInstanceRef = useRef<any>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);

  // 同步 lastContentRef 和 props value
  useEffect(() => {
    lastContentRef.current = value || "";
  }, [value]);

  // 处理内容变化 - 使用防抖优化
  const handleContentChange = useCallback(
    (newContent: string) => {
      // 防重复调用逻辑
      const condition1 = isInternalUpdateRef.current;
      const condition2 = !newContent || newContent.length === 0;
      const condition3 =
        lastContentRef.current && lastContentRef.current.length > 0;
      const shouldIgnore = condition1 && condition2 && condition3;

      // 如果是内部更新导致的onChange，且内容为空，则忽略
      if (shouldIgnore) {
        return;
      }

      // 准备调用父组件的onChange
      try {
        // Monaco内容变化处理
        onChange(newContent);

        // 更新最后的内容引用，用于防重复调用逻辑
        lastContentRef.current = newContent || "";
      } catch (error) {
        console.error("Monaco onChange调用失败:", error);
      }
    },
    [onChange],
  );

  // 编辑器准备就绪的回调函数
  const handleEditorReady = useCallback(
    (editor: any) => {
      // 保存编辑器实例
      editorInstanceRef.current = editor;

      // 设置编辑器准备状态
      setIsEditorReady(true);

      // 调用原始的 onEditorReady 回调
      if (onEditorReady) {
        try {
          onEditorReady(editor);
        } catch (error) {
          console.error("onEditorReady 回调调用失败:", error);
        }
      }
    },
    [onEditorReady],
  );

  // 编辑器准备就绪后的副作用
  useEffect(() => {
    if (isEditorReady && editorInstanceRef.current) {
      const editor = editorInstanceRef.current;

      // 调用外部传入的 onMount 回调
      if (onMount) {
        try {
          onMount(editor);
        } catch (error) {
          console.error("onMount 回调调用失败:", error);
        }
      }
    }
  }, [isEditorReady, onMount]);

  // 依赖项变化跟踪（简化版本）
  const depsRef = useRef({
    onChange,
    handlePaste,
    onConfirm,
    onMount,
    readOnly,
  });

  depsRef.current = { onChange, handlePaste, onConfirm, onMount, readOnly };

  // 主要编辑器初始化逻辑
  useEffect(() => {
    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
    let disposables: (() => void)[] = [];
    let isMounted = true;

    // 粘贴处理器
    const pasteHandler = (event: ClipboardEvent) => {
      // 检查事件的目标是否在我们的编辑器内部
      if (
        editorRef.current &&
        editorRef.current.getDomNode()?.contains(event.target as Node)
      ) {
        // 检查剪贴板内容类型
        const clipboardData = event.clipboardData;
        const hasImages =
          clipboardData?.items &&
          Array.from(clipboardData.items).some((item) =>
            item.type.startsWith("image/"),
          );

        if (hasImages) {
          // 有图像：阻止默认行为，使用我们的处理器
          event.preventDefault();
          event.stopImmediatePropagation();
          handlePaste?.(event as any);
        }
        // 没有图像：让Monaco正常处理文本粘贴
      }
    };

    // 在捕获阶段监听 document 的 paste 事件（主要用于图像）
    if (handlePaste) {
      document.addEventListener("paste", pasteHandler, true);
    }

    if (containerRef.current) {
      setIsLoading(true);

      loadMonaco()
        .then((monaco) => {
          if (!isMounted || !containerRef.current) {
            return;
          }

          const container = containerRef.current;
          container.innerHTML = "";

          // 安全地创建编辑器实例
          try {
            editorInstance = monaco.editor.create(container, {
              ...PERFORMANCE_OPTIONS,
              value: value || "",
              readOnly,
            });
          } catch (createError) {
            console.error("Monaco 编辑器创建失败:", createError);
            throw new Error(
              `编辑器创建失败: ${createError instanceof Error ? createError.message : "未知错误"}`,
            );
          }

          editorRef.current = editorInstance;

          if (editorInstance) {
            // 保存当前编辑器实例的引用，避免在回调中访问可能为null的变量
            const currentEditor = editorInstance;
            const changeDisposable = currentEditor.onDidChangeModelContent(
              () => {
                const currentValue = currentEditor.getValue();
                const selection = currentEditor.getSelection();

                // 标记这是用户输入导致的变化
                isUserInputRef.current = true;

                if (currentValue !== value) {
                  // 使用防抖更新统计信息，减少重渲染
                  debouncedSetStats(updateStats(currentValue));
                  onChange(currentValue);

                  // 在 onChange 调用后更新同步状态
                  setTimeout(() => {
                    lastSyncedValue.current = currentValue;
                    isUserInputRef.current = false; // 重置标志位
                  }, 0);
                } else {
                  // 即使内容相同，也可能需要更新统计信息（比如格式化导致的变化）
                  debouncedSetStats(updateStats(currentValue));
                  isUserInputRef.current = false; // 重置标志位
                }
              },
            );
            disposables.push(() => changeDisposable.dispose());

            if (onConfirm) {
              const commandDisposable = currentEditor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                onConfirm,
              );
              // 安全地处理dispose方法，避免类型错误
              if (
                commandDisposable &&
                typeof (commandDisposable as any).dispose === "function"
              ) {
                disposables.push(() => {
                  try {
                    (commandDisposable as any).dispose();
                  } catch (e) {
                    // 忽略清理错误
                  }
                });
              }
            }
          }

          // 调用 handleEditorReady 设置编辑器状态
          try {
            handleEditorReady(editorInstance);
          } catch (readyError) {
            console.error("handleEditorReady 执行失败:", readyError);
            // 不抛出错误，让编辑器继续工作
          }

          // 调用外部 onMount 回调
          if (onMount) {
            try {
              onMount(editorInstance);
            } catch (mountError) {
              console.error("onMount 回调执行失败:", mountError);
              // 不抛出错误，让编辑器继续工作
            }
          }

          // 设置初始统计信息
          const initialValue = editorInstance.getValue() || "";
          setStats(updateStats(initialValue));

          // 设置初始值已设置标志，防止后续用户输入时误触发 setValue
          isInitialValueSet.current = true;
          lastSyncedValue.current = initialValue;
          editorInitTime.current = performance.now();

          // 初始化鼠标中键滚动系统
          const middleClickScrollSystem = new MiddleClickScrollSystem(
            monacoStyles,
          );
          middleClickScrollSystem.initialize(editorInstance);

          // 初始化键盘处理器
          const keyboardHandler = new KeyboardHandler(editorInstance);
          keyboardHandler.applyFixesWithDelay();

          setIsLoading(false);
        })
        .catch((err) => {
          console.error("Monaco 初始化失败", err);

          // 尝试降级到简单的 textarea
          try {
            if (containerRef.current) {
              const container = containerRef.current;
              container.innerHTML = `
                <textarea 
                  style="width: 100%; height: 200px; border: 1px solid #ccc; padding: 8px; font-family: monospace; resize: vertical;"
                  placeholder="编辑器加载失败，使用备用输入框..."
                  value="${value || ""}"
                ></textarea>
              `;

              const textarea = container.querySelector(
                "textarea",
              ) as HTMLTextAreaElement;
              if (textarea) {
                textarea.addEventListener("input", (e) => {
                  const target = e.target as HTMLTextAreaElement;
                  onChange?.(target.value);
                });

                if (onMount) {
                  onMount(textarea);
                }
              }
            }
          } catch (fallbackError) {
            console.error("降级方案也失败:", fallbackError);
          }

          setError("编辑器加载失败，已启用备用输入框");
          setIsLoading(false);
        });
    }

    // 清理函数
    return () => {
      isMounted = false;

      // 清理防抖timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }

      // 清理全局监听器
      if (handlePaste) {
        document.removeEventListener("paste", pasteHandler, true);
      }

      disposables.forEach((dispose) => dispose());

      if (editorInstance) {
        editorInstance.dispose();
      }

      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, handlePaste, onConfirm, onMount, readOnly]);

  // 处理外部 value 变化 - 防止光标跳转
  const isInitialValueSet = useRef(false);
  const lastSyncedValue = useRef<string>("");
  const isUserInputRef = useRef(false); // 标记是否是用户输入导致的变化
  const editorInitTime = useRef<number>(0); // 编辑器初始化时间，用于保护期

  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      const safeValue = safeTextValue(value);
      const selection = editorRef.current.getSelection();

      // 最精确的同步判断
      const shouldUpdateValue =
        !isInitialValueSet.current ||
        (safeValue !== currentValue && !isUserInputRef.current);

      // 额外安全检查：编辑器初始化后 500ms 内禁止任何 setValue 调用
      const timeSinceInit = performance.now() - editorInitTime.current;
      const inProtectionPeriod =
        editorInitTime.current > 0 && timeSinceInit < 500;

      // 如果在保护期内，强制跳过 setValue
      if (inProtectionPeriod) {
        // 同步统计信息但不调用 setValue
        debouncedSetStats(updateStats(safeValue));
        lastSyncedValue.current = safeValue;
        return;
      }

      if (shouldUpdateValue) {
        // 始终保存光标位置和滚动位置
        let scrollTop = 0;
        try {
          const rawScrollTop = editorRef.current.getScrollTop();
          scrollTop =
            rawScrollTop !== undefined &&
            rawScrollTop !== null &&
            !isNaN(rawScrollTop) &&
            rawScrollTop >= 0
              ? rawScrollTop
              : 0;
        } catch (error) {
          console.warn("获取滚动位置失败:", error);
          scrollTop = 0;
        }

        try {
          editorRef.current.setValue(safeValue);

          // 改进：总是尝试恢复光标位置（不管是否是初始设置）
          if (selection && isInitialValueSet.current) {
            // 使用 requestAnimationFrame 确保在 DOM 更新后恢复光标
            requestAnimationFrame(() => {
              if (editorRef.current && !isDisposedRef.current) {
                try {
                  editorRef.current.setSelection(selection);
                  // 确保 scrollTop 是有效的数值
                  if (
                    scrollTop !== undefined &&
                    scrollTop !== null &&
                    !isNaN(scrollTop) &&
                    scrollTop >= 0
                  ) {
                    editorRef.current.setScrollTop(scrollTop);
                  }
                } catch (error) {
                  console.error("光标恢复失败:", error);
                }
              }
            });
          }

          setStats(updateStats(safeValue));

          // 更新同步状态
          lastSyncedValue.current = safeValue;
          isUserInputRef.current = false; // 重置用户输入标志位
        } catch (error) {
          console.error("setValue 失败:", error);
          setStats(updateStats(safeValue));
          lastSyncedValue.current = safeValue;
          isUserInputRef.current = false; // 重置用户输入标志位
        }
      } else {
        // 即使不更新值，也要同步统计信息（使用防抖避免频繁重渲染）
        debouncedSetStats(updateStats(safeValue));
        lastSyncedValue.current = safeValue;
      }
    }
  }, [value, autoFocus, debouncedSetStats]);

  // 额外的聚焦机制
  useEffect(() => {
    if (autoFocus && editorRef.current && !isDisposedRef.current) {
      const timer = setTimeout(() => {
        if (editorRef.current && !isDisposedRef.current) {
          try {
            editorRef.current.focus();
          } catch (error) {
            // 忽略聚焦错误
          }
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  // 预计算类名
  const panelClassName = useMemo(
    () => monacoStyles["monaco-unified-wrapper"],
    [],
  );

  // 全选：供移动端使用（Monaco 在触摸设备上无键盘且长按菜单已禁用）
  const handleSelectAll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const action = editor.getAction?.("editor.action.selectAll");
      if (action?.run) {
        action.run();
      } else {
        const model = editor.getModel();
        if (model) {
          editor.setSelection(model.getFullModelRange());
          editor.focus();
        }
      }
    } catch (e) {
      console.warn("Monaco selectAll failed:", e);
    }
  }, []);

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        onReload={() => window.location.reload()}
        className={className}
      />
    );
  }

  // 统一的渲染布局（消息编辑器模式）
  return (
    <div className={panelClassName}>
      {/* Monaco Editor 编辑器 */}
      <div className={monacoStyles["monaco-wrapper"]}>
        <div className={monacoStyles["monaco-status-bar-row"]}>
          <StatsBar stats={stats} text={value} images={images} />
          <button
            type="button"
            className={monacoStyles["monaco-select-all-btn"]}
            onClick={handleSelectAll}
            title="全选"
            aria-label="全选"
          >
            全选
          </button>
        </div>

        <div
          ref={containerRef}
          className={monacoStyles["monaco-editor-wrapper"]}
          style={{
            opacity: isLoading ? 0.3 : 1,
            transition: "opacity 0.3s ease-in-out",
          }}
          onPaste={(event) => {
            // React 级别的粘贴事件（简化处理）
            // 主要处理逻辑在全局监听器中
          }}
        />

        <LoadingIndicator isLoading={isLoading} />
      </div>

      {/* 图片附件区域 */}
      {images.length > 0 && (
        <ImageAttachments
          images={images}
          onImageDelete={onImageDelete || (() => {})}
        />
      )}
    </div>
  );
};

export default MonacoUnifiedEditor;
