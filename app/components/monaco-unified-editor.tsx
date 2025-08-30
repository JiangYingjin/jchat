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
  // 🔍 调试：记录组件接收到的props
  console.log("🔍 [MonacoUnifiedEditorFixed] 组件接收到props:", {
    hasValue: !!value,
    valueLength: value?.length || 0,
    hasOnChange: !!onChange,
    hasOnEditorReady: !!onEditorReady,
    readOnly,
    autoFocus,
    imagesCount: images?.length || 0,
    hasOnImageDelete: !!onImageDelete,
    hasHandlePaste: !!handlePaste,
    hasOnConfirm: !!onConfirm,
    hasOnMount: !!onMount,
    handlePasteName: handlePaste?.name || "undefined",
    onChangeName: onChange?.name || "anonymous",
    onChangeRef: onChange?.toString().slice(0, 50) + "...",
    timestamp: Date.now(),
  });

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
      console.log(
        "✅ [MonacoUnifiedEditorFixed] 接收到 onEditorReady 信号，编辑器实例已保存",
        {
          hasEditor: !!editor,
          editorType: typeof editor,
          editorMethods: Object.getOwnPropertyNames(
            Object.getPrototypeOf(editor),
          ).slice(0, 10),
          timestamp: Date.now(),
        },
      );
      // 保存编辑器实例
      editorInstanceRef.current = editor;
      console.log("💾 [MonacoUnifiedEditorFixed] 编辑器实例已保存到 ref", {
        hasEditorInRef: !!editorInstanceRef.current,
        timestamp: Date.now(),
      });

      // 设置编辑器准备状态
      setIsEditorReady(true);
      console.log("🚀 [MonacoUnifiedEditorFixed] 设置 isEditorReady 为 true", {
        isEditorReadyState: true,
        timestamp: Date.now(),
      });

      // 调用原始的 onEditorReady 回调
      if (onEditorReady) {
        try {
          console.log(
            "🔄 [MonacoUnifiedEditorFixed] 调用外部 onEditorReady 回调",
          );
          onEditorReady(editor);
          console.log(
            "✅ [MonacoUnifiedEditorFixed] 外部 onEditorReady 回调调用成功",
          );
        } catch (error) {
          console.error(
            "[MonacoUnifiedEditorFixed] onEditorReady 回调调用失败:",
            error,
          );
        }
      } else {
        console.log(
          "ℹ️ [MonacoUnifiedEditorFixed] 未提供外部 onEditorReady 回调",
        );
      }
    },
    [onEditorReady],
  );

  // 编辑器准备就绪后的副作用 - 现在主要用于调试和外部回调
  useEffect(() => {
    console.log("🔍 [MonacoUnifiedEditorFixed] 编辑器准备就绪状态检查:", {
      isEditorReady,
      hasEditorInstance: !!editorInstanceRef.current,
      hasEditorRef: !!editorRef.current,
      timestamp: Date.now(),
    });

    if (isEditorReady && editorInstanceRef.current) {
      console.log(
        "🚀 [MonacoUnifiedEditorFixed] 编辑器已准备就绪，调用外部回调...",
      );

      // 由于监听器已在初始化时原子化附加，这里只需调用外部回调
      const editor = editorInstanceRef.current;

      // 调用外部传入的 onMount（如果还没有调用过）
      if (onMount) {
        try {
          console.log("🔄 [MonacoUnifiedEditorFixed] 调用外部 onMount 回调");
          onMount(editor);
          console.log(
            "✅ [MonacoUnifiedEditorFixed] 外部 onMount 回调调用成功",
          );
        } catch (error) {
          console.error(
            "❌ [MonacoUnifiedEditorFixed] onMount 回调调用失败:",
            error,
          );
        }
      } else {
        console.log("ℹ️ [MonacoUnifiedEditorFixed] 未提供外部 onMount 回调");
      }
    }
  }, [isEditorReady, onMount]);

  // 🔍 依赖项变化跟踪
  const depsRef = useRef({
    onChange,
    handlePaste,
    onConfirm,
    onMount,
    readOnly,
  });
  const prevDeps = depsRef.current;
  const currentDeps = { onChange, handlePaste, onConfirm, onMount, readOnly };

  // 检查哪个依赖项变化了
  const changedDeps = [];
  if (prevDeps.onChange !== currentDeps.onChange) changedDeps.push("onChange");
  if (prevDeps.handlePaste !== currentDeps.handlePaste)
    changedDeps.push("handlePaste");
  if (prevDeps.onConfirm !== currentDeps.onConfirm)
    changedDeps.push("onConfirm");
  if (prevDeps.onMount !== currentDeps.onMount) changedDeps.push("onMount");
  if (prevDeps.readOnly !== currentDeps.readOnly) changedDeps.push("readOnly");

  if (changedDeps.length > 0) {
    console.log("🔄 [MonacoUnifiedEditorFixed] 检测到依赖项变化:", {
      changedDeps,
      onChange:
        currentDeps.onChange === prevDeps.onChange ? "unchanged" : "changed",
      handlePaste:
        currentDeps.handlePaste === prevDeps.handlePaste
          ? "unchanged"
          : "changed",
      onConfirm:
        currentDeps.onConfirm === prevDeps.onConfirm ? "unchanged" : "changed",
      onMount:
        currentDeps.onMount === prevDeps.onMount ? "unchanged" : "changed",
      readOnly:
        currentDeps.readOnly === prevDeps.readOnly ? "unchanged" : "changed",
    });
  }

  depsRef.current = currentDeps;

  // ========== 终极解决方案 V6：全局事件捕获 ==========
  useEffect(() => {
    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
    let disposables: (() => void)[] = [];
    let isMounted = true;

    console.log("🏗️ [MonacoUnifiedEditorFixed] useEffect 启动/重新启动...", {
      onChangeName: onChange?.name || "anonymous",
      onChangeRef: onChange?.toString().slice(0, 50) + "...",
      handlePasteName: handlePaste?.name || "undefined",
      handlePasteRef: handlePaste?.toString().slice(0, 50) + "...",
      onConfirmName: onConfirm?.name || "undefined",
      onConfirmRef: onConfirm?.toString().slice(0, 50) + "...",
      onMountName: onMount?.name || "undefined",
      onMountRef: onMount?.toString().slice(0, 50) + "...",
      readOnly,
      timestamp: Date.now(),
    });

    // 关键：将粘贴处理器定义在 useEffect 外部无法访问的区域，
    // 以确保每次 effect 运行时都创建新的、正确的闭包。
    const pasteHandler = (event: ClipboardEvent) => {
      // 检查事件的目标是否在我们的编辑器内部
      if (
        editorRef.current &&
        editorRef.current.getDomNode()?.contains(event.target as Node)
      ) {
        console.log("📋 全局 Paste 事件被捕获，且目标是本编辑器");

        // 检查剪贴板内容类型
        const clipboardData = event.clipboardData;
        const hasImages =
          clipboardData?.items &&
          Array.from(clipboardData.items).some((item) =>
            item.type.startsWith("image/"),
          );
        const hasText =
          clipboardData?.getData("text/plain") ||
          clipboardData?.getData("text/html");

        console.log("🔍 剪贴板内容分析:", {
          hasImages,
          hasText,
          imageTypes: Array.from(clipboardData?.items || [])
            .filter((item) => item.type.startsWith("image/"))
            .map((item) => item.type),
          textContent: hasText
            ? hasText.length > 100
              ? hasText.substring(0, 100) + "..."
              : hasText
            : "none",
        });

        if (hasImages) {
          // 有图像：阻止默认行为，使用我们的处理器
          console.log("🖼️ 检测到图像粘贴，使用自定义处理器");
          event.preventDefault();
          event.stopImmediatePropagation();
          handlePaste?.(event as any);
        } else {
          // 没有图像：让Monaco正常处理文本粘贴
          console.log("📝 检测到文本粘贴或无特殊内容，让Monaco正常处理");
          // 不阻止事件，让它继续传播到Monaco
        }
      }
    };

    // 在捕获阶段监听 document 的 paste 事件（主要用于图像）
    if (handlePaste) {
      document.addEventListener("paste", pasteHandler, true); // `true` 表示捕获阶段
      console.log("✅ 全局 paste 监听器（捕获模式）已附加");
    }

    if (containerRef.current) {
      setIsLoading(true);
      loadMonaco()
        .then((monaco) => {
          if (!isMounted || !containerRef.current) return;

          const container = containerRef.current;
          container.innerHTML = "";

          editorInstance = monaco.editor.create(container, {
            ...PERFORMANCE_OPTIONS,
            value: value || "",
            readOnly,
          });
          editorRef.current = editorInstance;

          // --- 附加其他非粘贴的监听器 ---
          if (editorInstance) {
            // 保存当前编辑器实例的引用，避免在回调中访问可能为null的变量
            const currentEditor = editorInstance;
            const changeDisposable = currentEditor.onDidChangeModelContent(
              () => {
                const currentValue = currentEditor.getValue();
                if (currentValue !== value) {
                  onChange(currentValue);
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

          onMount?.(editorInstance);

          // 初始化自动滚动系统
          const autoScrollSystem = new AutoScrollSystem(monacoStyles);
          autoScrollSystem.initialize(editorInstance);

          // 初始化键盘处理器
          const keyboardHandler = new KeyboardHandler(editorInstance);
          keyboardHandler.applyFixesWithDelay();

          setIsLoading(false);
          console.log("🎉 编辑器核心初始化完成");
        })
        .catch((err) => {
          console.error("❌ Monaco 初始化失败", err);
          setError("编辑器加载失败");
          setIsLoading(false);
        });
    }

    // --- 清理函数 ---
    return () => {
      isMounted = false;
      console.log("🧹 开始清理副作用...");

      // 清理全局监听器
      if (handlePaste) {
        document.removeEventListener("paste", pasteHandler, true);
        console.log("✅ 全局 paste 监听器已移除");
      }

      disposables.forEach((dispose) => dispose());
      editorInstance?.dispose();
      editorRef.current = null;
      console.log("✅ 副作用清理完成");
    };
  }, [onChange, handlePaste, onConfirm, onMount, readOnly]); // 移除 value 依赖项，避免每次输入都重新初始化

  // 处理外部 value 变化
  const isInitialValueSet = useRef(false);
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      const safeValue = safeTextValue(value);

      if (
        !isInitialValueSet.current ||
        (currentValue !== safeValue && safeValue !== currentValue)
      ) {
        const selection = editorRef.current.getSelection();
        const scrollTop = editorRef.current.getScrollTop();

        try {
          editorRef.current.setValue(safeValue);

          if (selection && isInitialValueSet.current) {
            editorRef.current.setSelection(selection);
            editorRef.current.setScrollTop(scrollTop);
          }

          setStats(updateStats(safeValue));
          isInitialValueSet.current = true;

          if (autoFocus) {
            delay(50).then(() => {
              if (editorRef.current && !isDisposedRef.current) {
                try {
                  editorRef.current.focus();
                } catch (error) {
                  // 忽略聚焦错误
                }
              }
            });
          }
        } catch (error) {
          setStats(updateStats(safeValue));
          isInitialValueSet.current = true;
        }
      }
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

  // 组件挂载/卸载日志
  useEffect(() => {
    console.log("🎯 [MonacoUnifiedEditorFixed] 组件挂载", {
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
      console.log("💥 [MonacoUnifiedEditorFixed] 组件卸载", {
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

  // 简化保护机制
  useLayoutEffect(() => {
    console.log("[MonacoUnifiedEditorFixed] useLayoutEffect 触发", {
      hasEditor: !!editorRef.current,
      isLoading,
      isDisposed: isDisposedRef.current,
      timestamp: Date.now(),
    });
  }, [isLoading]);

  // 添加键盘事件监听器来调试
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "v") {
        console.log("⌨️ [MonacoUnifiedEditorFixed] 检测到 Ctrl+V 按键", {
          ctrlKey: event.ctrlKey,
          key: event.key,
          target: event.target,
          targetTagName: (event.target as Element)?.tagName,
          timestamp: Date.now(),
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    console.log("⌨️ [MonacoUnifiedEditorFixed] 键盘监听器已添加");

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      console.log("⌨️ [MonacoUnifiedEditorFixed] 键盘监听器已移除");
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

  // 🔍 调试：记录渲染状态
  console.log("🎨 [MonacoUnifiedEditorFixed] 组件渲染中", {
    isLoading,
    hasError: !!error,
    isEditorReady,
    hasEditorInstance: !!editorInstanceRef.current,
    imagesCount: images?.length || 0,
    stats,
    timestamp: Date.now(),
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
            // 🔍 调试：记录 React 级别的粘贴事件
            console.log(
              "🔍 [MonacoUnifiedEditorFixed] React 级别的粘贴事件触发",
              {
                eventType: event.type,
                hasClipboardData: !!event.clipboardData,
                clipboardDataItems: event.clipboardData?.items?.length,
                clipboardDataTypes: Array.from(
                  event.clipboardData?.items || [],
                ).map((item) => item.type),
                defaultPrevented: event.isDefaultPrevented(),
                timestamp: Date.now(),
              },
            );
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
