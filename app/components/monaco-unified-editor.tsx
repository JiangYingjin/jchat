import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useLayoutEffect,
} from "react";

import styles from "../styles/chat.module.scss";
import clsx from "clsx";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "./button";
import {
  getMonaco,
  isMonacoLoaded,
  monacoPreloader,
} from "../utils/monaco-preloader";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "./ui-lib";

// 导入抽分出的模块
import {
  loadMonaco,
  PERFORMANCE_OPTIONS,
  AutoScrollSystem,
  KeyboardHandler,
  StatsBar,
  ErrorDisplay,
  LoadingIndicator,
  updateStats,
  safeTextValue,
  isComponentMounted,
  safeFocusEditor,
  delay,
} from "./monaco";

/**
 * 统一的 Monaco 编辑器组件
 * 合并了 MonacoEditor 和 MonacoMessageEditor 的功能
 * 支持基础编辑器模式和消息编辑器模式
 */

// 🚀 图片附件组件（内联到主组件中）
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
 * === 终极解决方案 V6：全局事件捕获 ===
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

  // 处理内容变化
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
      } else {
        console.error("没有提供外部 onEditorReady 回调");
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

  // ========== 终极解决方案 V6：全局事件捕获 ==========
  useEffect(() => {
    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
    let disposables: (() => void)[] = [];
    let isMounted = true;

    // 关键：将粘贴处理器定义在 useEffect 外部无法访问的区域，
    // 以确保每次 effect 运行时都创建新的、正确的闭包。
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
      document.addEventListener("paste", pasteHandler, true); // `true` 表示捕获阶段
    }

    if (containerRef.current) {
      setIsLoading(true);

      loadMonaco()
        .then((monaco) => {
          if (!isMounted || !containerRef.current) {
            console.log("⚠️ [DEBUG] 组件已卸载或容器不存在，跳过编辑器创建");
            return;
          }

          const container = containerRef.current;
          container.innerHTML = "";

          editorInstance = monaco.editor.create(container, {
            ...PERFORMANCE_OPTIONS,
            value: value || "",
            readOnly,
          });

          editorRef.current = editorInstance;

          if (editorInstance) {
            // 保存当前编辑器实例的引用，避免在回调中访问可能为null的变量
            const currentEditor = editorInstance;
            const changeDisposable = currentEditor.onDidChangeModelContent(
              () => {
                const currentValue = currentEditor.getValue();
                const selection = currentEditor.getSelection();

                // 修复：在内容变化时立即更新统计信息
                setStats(updateStats(currentValue));

                // 终极修复：标记这是用户输入导致的变化
                isUserInputRef.current = true;

                if (currentValue !== value) {
                  console.log("调用 onChange，因为内容不同:", {
                    currentLength: currentValue.length,
                    propsLength: value?.length || 0,
                    timestamp: performance.now(),
                  });

                  onChange(currentValue);

                  // 在 onChange 调用后更新同步状态
                  // 使用 setTimeout 确保在下次 useEffect 运行前更新
                  setTimeout(() => {
                    console.log("setTimeout 回调执行，重置标志位:", {
                      newLastSyncedLength: currentValue.length,
                      timestamp: performance.now(),
                    });
                    lastSyncedValue.current = currentValue;
                    isUserInputRef.current = false; // 重置标志位
                  }, 0);
                } else {
                  console.log("内容相同，直接重置标志位");
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

          // 关键修复：调用 handleEditorReady 设置编辑器状态
          handleEditorReady(editorInstance);

          // 调用外部 onMount 回调
          onMount?.(editorInstance);

          // 设置初始统计信息
          const initialValue = editorInstance.getValue() || "";
          setStats(updateStats(initialValue));

          // 🔥 关键修复：立即设置初始值已设置标志，防止后续用户输入时误触发 setValue
          isInitialValueSet.current = true;
          lastSyncedValue.current = initialValue;
          editorInitTime.current = performance.now();

          // 初始化自动滚动系统
          const autoScrollSystem = new AutoScrollSystem(monacoStyles);
          autoScrollSystem.initialize(editorInstance);

          // 初始化键盘处理器
          const keyboardHandler = new KeyboardHandler(editorInstance);
          keyboardHandler.applyFixesWithDelay();

          setIsLoading(false);
        })
        .catch((err) => {
          console.error("❌ Monaco 初始化失败", err);
          setError("编辑器加载失败");
          setIsLoading(false);
        });
    }

    // 清理函数
    return () => {
      isMounted = false;

      // 清理全局监听器
      if (handlePaste) {
        document.removeEventListener("paste", pasteHandler, true);
        console.log("✅ [DEBUG] 全局 paste 监听器已移除");
      }

      console.log("🗑️ [DEBUG] 清理 disposables:", disposables.length);
      disposables.forEach((dispose) => dispose());

      if (editorInstance) {
        console.log("💥 [DEBUG] 销毁编辑器实例");
        editorInstance.dispose();
      }

      editorRef.current = null;
      console.log("✅ [DEBUG] 副作用清理完成");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, handlePaste, onConfirm, onMount, readOnly]); // 故意移除 value 依赖项，避免每次输入都重新初始化

  // 处理外部 value 变化 - 终极修复版本，防止光标跳转
  const isInitialValueSet = useRef(false);
  const lastSyncedValue = useRef<string>("");
  const isUserInputRef = useRef(false); // 标记是否是用户输入导致的变化
  const editorInitTime = useRef<number>(0); // 编辑器初始化时间，用于保护期

  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      const safeValue = safeTextValue(value);
      const selection = editorRef.current.getSelection();

      // 终极修复：最精确的同步判断
      // 只在以下情况才调用 setValue：
      // 1. 首次设置值（编辑器刚初始化）- 现在应该不会发生，因为我们在初始化时就设置了
      // 2. 外部 value 真的不同于当前编辑器值，且不是用户刚刚的输入导致的
      const shouldUpdateValue =
        !isInitialValueSet.current ||
        (safeValue !== currentValue && !isUserInputRef.current);

      // 🔥 额外安全检查：编辑器初始化后 500ms 内禁止任何 setValue 调用
      const timeSinceInit = performance.now() - editorInitTime.current;
      const inProtectionPeriod =
        editorInitTime.current > 0 && timeSinceInit < 500;

      // 如果在保护期内，强制跳过 setValue
      if (inProtectionPeriod) {
        // 同步统计信息但不调用 setValue
        setStats(updateStats(safeValue));
        lastSyncedValue.current = safeValue;
        return;
      }

      if (shouldUpdateValue) {
        // 始终保存光标位置和滚动位置
        const scrollTop = editorRef.current.getScrollTop();

        try {
          editorRef.current.setValue(safeValue);
          console.log("✅ [DEBUG] setValue 执行完成");

          // 改进：总是尝试恢复光标位置（不管是否是初始设置）
          if (selection && isInitialValueSet.current) {
            console.log("🔄 [DEBUG] 尝试恢复光标位置:", {
              targetSelection:
                selection.startLineNumber +
                ":" +
                selection.startColumn +
                " to " +
                selection.endLineNumber +
                ":" +
                selection.endColumn,
              timestamp: performance.now(),
            });

            // 使用 requestAnimationFrame 确保在 DOM 更新后恢复光标
            requestAnimationFrame(() => {
              if (editorRef.current && !isDisposedRef.current) {
                try {
                  const newSelection = editorRef.current.getSelection();
                  console.log("🎯 [DEBUG] requestAnimationFrame 中恢复光标:", {
                    beforeRestore:
                      newSelection?.startLineNumber +
                      ":" +
                      newSelection?.startColumn,
                    restoreTarget:
                      selection.startLineNumber + ":" + selection.startColumn,
                    timestamp: performance.now(),
                  });

                  editorRef.current.setSelection(selection);
                  editorRef.current.setScrollTop(scrollTop);

                  const finalSelection = editorRef.current.getSelection();
                  console.log("✅ [DEBUG] 光标恢复完成:", {
                    finalSelection:
                      finalSelection?.startLineNumber +
                      ":" +
                      finalSelection?.startColumn,
                    timestamp: performance.now(),
                  });
                } catch (error) {
                  console.error("❌ [DEBUG] 光标恢复失败:", error);
                }
              }
            });
          }

          setStats(updateStats(safeValue));

          // 更新同步状态（现在不应该是"首次设置"了）
          lastSyncedValue.current = safeValue;
          isUserInputRef.current = false; // 重置用户输入标志位

          console.log("📝 [DEBUG] setValue 后状态更新完成:", {
            newLastSyncedLength: safeValue.length,
            resetUserInput: false,
            timestamp: performance.now(),
          });

          // 注意：现在不应该有自动聚焦，因为不应该是"首次设置"
        } catch (error) {
          console.error("❌ [DEBUG] setValue 失败:", error);
          setStats(updateStats(safeValue));
          lastSyncedValue.current = safeValue;
          isUserInputRef.current = false; // 重置用户输入标志位
        }
      } else {
        console.log("⏭️ [DEBUG] 跳过 setValue，同步统计信息:", {
          reason: isInitialValueSet.current
            ? isUserInputRef.current
              ? "用户输入中"
              : "值相同"
            : "不应该发生的情况",
          timestamp: performance.now(),
        });

        // 即使不更新值，也要同步统计信息
        setStats(updateStats(safeValue));
        lastSyncedValue.current = safeValue;
      }
    } else {
      console.log("⚠️ [DEBUG] editorRef.current 不存在，跳过同步");
    }
  }, [value, autoFocus]);

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

  // 🔍 详细调试：组件挂载/卸载跟踪
  useEffect(() => {
    console.log("🎯 [DEBUG] MonacoUnifiedEditor 组件挂载:", {
      timestamp: Date.now(),
      hasEditor: !!editorRef.current,
      hasEditorInstance: !!editorInstanceRef.current,
      isEditorReady,
      isLoading,
      hasError: !!error,
      valueLength: value?.length || 0,
      imagesCount: images?.length || 0,
      hasOnChange: !!onChange,
      hasOnEditorReady: !!onEditorReady,
      hasHandlePaste: !!handlePaste,
      hasOnConfirm: !!onConfirm,
      hasOnMount: !!onMount,
    });

    return () => {
      console.log("💥 [DEBUG] MonacoUnifiedEditor 组件卸载:", {
        hasEditor: !!editorRef.current,
        hasEditorInstance: !!editorInstanceRef.current,
        isEditorReady,
        isLoading,
        hasError: !!error,
        timestamp: Date.now(),
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 预计算类名
  const panelClassName = useMemo(
    () => monacoStyles["system-prompt-input-panel"],
    [],
  );

  // 🔍 详细调试：光标位置跟踪和键盘事件监听
  useEffect(() => {
    let lastSelection: any = null;

    const trackCursor = () => {
      if (editorRef.current) {
        const currentSelection = editorRef.current.getSelection();
        if (
          currentSelection &&
          (!lastSelection ||
            lastSelection.startLineNumber !==
              currentSelection.startLineNumber ||
            lastSelection.startColumn !== currentSelection.startColumn)
        ) {
          const isAtStart =
            currentSelection.startLineNumber === 1 &&
            currentSelection.startColumn === 1;
          console.log("🎯 [DEBUG] 光标位置变化:", {
            from: lastSelection
              ? `${lastSelection.startLineNumber}:${lastSelection.startColumn}`
              : "null",
            to: `${currentSelection.startLineNumber}:${currentSelection.startColumn}`,
            timestamp: performance.now(),
            isAtStart: isAtStart,
            isJumpToStart:
              lastSelection &&
              (lastSelection.startLineNumber !== 1 ||
                lastSelection.startColumn !== 1) &&
              isAtStart,
            timeSinceEditorInit:
              editorInitTime.current > 0
                ? (performance.now() - editorInitTime.current).toFixed(1) + "ms"
                : "unknown",
          });

          // 特别警告：如果光标跳转到开头
          if (
            lastSelection &&
            (lastSelection.startLineNumber !== 1 ||
              lastSelection.startColumn !== 1) &&
            isAtStart
          ) {
            console.warn(
              "🚨 [DEBUG] 光标跳转到文档开头! 这是我们要解决的问题!",
              {
                previousPosition: `${lastSelection.startLineNumber}:${lastSelection.startColumn}`,
                jumpedToStart: "1:1",
                timeSinceInit:
                  editorInitTime.current > 0
                    ? (performance.now() - editorInitTime.current).toFixed(1) +
                      "ms"
                    : "unknown",
                timestamp: performance.now(),
              },
            );
          }
          lastSelection = { ...currentSelection };
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // 键盘事件处理
      if (event.ctrlKey && event.key === "v") {
        console.log("⌨️ [DEBUG] 检测到 Ctrl+V 按键");
      }

      // 在任何键盘输入后跟踪光标
      setTimeout(trackCursor, 0);
    };

    // 定期检查光标位置（用于捕获非键盘导致的变化）
    const cursorInterval = setInterval(trackCursor, 100);

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      clearInterval(cursorInterval);
    };
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

  // 🔍 详细调试：渲染状态
  console.log("🎨 [DEBUG] MonacoUnifiedEditor 渲染:", {
    isLoading,
    hasError: !!error,
    isEditorReady,
    hasEditorInstance: !!editorInstanceRef.current,
    hasEditorRef: !!editorRef.current,
    imagesCount: images?.length || 0,
    stats: {
      characters: stats.characters,
      lines: stats.lines,
      words: stats.words,
    },
    valueLength: value?.length || 0,
    isInitialValueSet: isInitialValueSet.current,
    isUserInput: isUserInputRef.current,
    lastSyncedLength: lastSyncedValue.current?.length || 0,
    timestamp: performance.now(),
  });

  // 统一的渲染布局（消息编辑器模式）
  return (
    <div className={panelClassName}>
      {/* Monaco Editor 编辑器 */}
      <div className={monacoStyles["monaco-wrapper"]}>
        <StatsBar stats={stats} />

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
