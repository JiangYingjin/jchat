import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
// 使用核心 API 而不是完整的 monaco-editor 包
// 这是一个专门为大文本优化的纯文本编辑器，移除了所有代码编辑特性
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";

// 动态导入Monaco Editor，避免SSR问题
let Monaco: any = null;
const loadMonaco = async () => {
  if (!Monaco && typeof window !== "undefined") {
    // 动态导入monaco-editor核心API
    Monaco = await import("monaco-editor/esm/vs/editor/editor.api");

    // 配置Monaco Editor - 简化为纯文本主题
    Monaco.editor.defineTheme("system-prompt-theme", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#333333",
        "editor.lineHighlightBackground": "#f5f5f5",
        "editorCursor.foreground": "#0066cc",
        "editor.selectionBackground": "#cce6ff",
      },
    });
  }
  return Monaco;
};

interface MonacoSystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

// 性能优化配置 - 专门为大文本系统提示词优化
// 已禁用所有语言服务功能（跳转、悬停、补全等）
const PERFORMANCE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    // 🚀 核心性能优化
    automaticLayout: true,
    wordWrap: "on",
    scrollBeyondLastLine: false,
    smoothScrolling: true,

    // 🎯 渲染优化
    renderLineHighlight: "none",
    renderWhitespace: "none",
    renderControlCharacters: false,
    renderFinalNewline: "off",

    // 💾 内存优化 - 专门为大文件优化
    maxTokenizationLineLength: 100000, // 增加最大标记化行长度
    stopRenderingLineAfter: 50000, // 增加停止渲染的行数阈值

    // 🚀 大文件性能优化
    largeFileOptimizations: true, // 启用大文件优化

    // 📊 虚拟化优化
    renderLineHighlightOnlyWhenFocus: true, // 只在聚焦时渲染行高亮

    // 🚀 额外的大文件优化
    // 禁用不必要的计算和渲染
    bracketPairColorization: { enabled: false }, // 禁用括号对颜色化
    guides: { bracketPairs: false, indentation: false }, // 禁用括号对和缩进指南
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
    }, // 禁用Unicode高亮
    // inlayHints: { enabled: false }, // 暂时注释掉，避免类型错误

    // 🚀 滚动和渲染优化
    fastScrollSensitivity: 5, // 增加快速滚动灵敏度
    mouseWheelScrollSensitivity: 1, // 鼠标滚轮滚动灵敏度

    // ⚡ 输入优化 - 完全禁用所有智能功能
    acceptSuggestionOnEnter: "off",
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    hover: { enabled: false },
    wordBasedSuggestions: "off", // 禁用基于词语的建议
    suggest: {
      // 完全禁用建议功能
      showKeywords: false,
      showSnippets: false,
      showClasses: false,
      showFunctions: false,
      showVariables: false,
      showModules: false,
      showProperties: false,
      showEvents: false,
      showOperators: false,
      showUnits: false,
      showValues: false,
      showConstants: false,
      showEnums: false,
      showEnumMembers: false,
      showColors: false,
      showFiles: false,
      showReferences: false,
      showFolders: false,
      showTypeParameters: false,
      showWords: false,
    },

    // 🎨 界面优化 - 移除所有不必要的UI元素
    minimap: { enabled: false },
    scrollbar: {
      vertical: "visible",
      horizontal: "visible",
      verticalScrollbarSize: 12,
      horizontalScrollbarSize: 12,
    },

    // 📝 编辑器行为 - 纯文本模式
    fontSize: 14,
    lineHeight: 22,
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,

    // 🛡️ 功能禁用（减少开销）
    codeLens: false,
    contextmenu: false, // 禁用右键菜单
    copyWithSyntaxHighlighting: false,
    emptySelectionClipboard: false,
    links: false,
    mouseWheelZoom: false,
    selectionClipboard: false,

    // 🖱️ 鼠标中键功能 - 启用原始效果
    // 启用鼠标中键点击后的快速滚动和选择功能
    multiCursorModifier: "alt", // 使用 Alt 键进行多光标操作

    // 🖱️ 鼠标中键拖拽和选择功能
    // 启用鼠标中键拖拽选择文本
    dragAndDrop: true, // 启用拖拽功能
    // 启用鼠标中键点击后的快速滚动
    // 启用鼠标中键选择文本（按住中键拖拽）
    // 启用鼠标中键点击后的快速定位

    // 🚫 完全禁用语言服务功能
    find: { addExtraSpaceOnTop: false }, // 禁用查找功能
    formatOnPaste: false, // 禁用粘贴时格式化
    formatOnType: false, // 禁用输入时格式化

    // 📐 布局 - 最小化装饰区域
    padding: { top: 16, bottom: 16 },
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,

    // 🚫 禁用所有自动行为
    autoClosingBrackets: "never",
    autoClosingQuotes: "never",
    autoSurround: "never",
    autoIndent: "none",

    // 🚫 禁用所有验证和装饰
    renderValidationDecorations: "off",
    occurrencesHighlight: "off",
    overviewRulerBorder: false,

    // 🚫 禁用所有跳转和导航功能
    // definitionLinkOpensInPeek: false, // 暂时注释掉，避免类型错误

    // 🚫 禁用所有代码操作
    // lightbulb: { enabled: false }, // 暂时注释掉，避免类型错误

    // 🚫 禁用所有语义功能
    // semanticValidation: false, // 暂时注释掉，避免类型错误
    // syntaxValidation: false, // 暂时注释掉，避免类型错误
  };

export const MonacoSystemPromptEditor: React.FC<
  MonacoSystemPromptEditorProps
> = ({
  value,
  onChange,
  onMount,
  className,
  readOnly = false,
  autoFocus = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const disposableRef = useRef<any>(null);
  const isDisposedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ characters: 0, lines: 0, words: 0 });

  // 🚀 性能监控
  const updateStats = useCallback((text: string | undefined) => {
    // 🛡️ 安全检查：确保text是有效字符串
    if (typeof text !== "string") {
      console.warn(
        "⚠️ [Monaco] updateStats 收到非字符串参数:",
        text,
        "类型:",
        typeof text,
      );
      setStats({ characters: 0, lines: 0, words: 0 });
      return;
    }

    try {
      const characters = text.length;
      const lines = text.split("\n").length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setStats({ characters, lines, words });
    } catch (error) {
      console.error("❌ [Monaco] updateStats 执行失败:", error, "text:", text);
      setStats({ characters: 0, lines: 0, words: 0 });
    }
  }, []);

  // 初始化Monaco Editor
  useEffect(() => {
    let isMounted = true;

    const initMonaco = async () => {
      try {
        const monaco = await loadMonaco();

        if (!isMounted || !containerRef.current) return;

        // 🛡️ 确保容器干净（防止"Element already has context attribute"错误）
        const container = containerRef.current;

        // 清理容器的所有子元素和属性
        container.innerHTML = "";

        // 移除可能存在的Monaco相关属性
        const monacoAttributes = Array.from(container.attributes).filter(
          (attr) =>
            attr.name.includes("monaco") || attr.name.includes("context"),
        );
        monacoAttributes.forEach((attr) => {
          try {
            container.removeAttribute(attr.name);
          } catch (e) {
            // 忽略移除属性时的错误
          }
        });

        // 🛡️ 确保value是安全的字符串
        const safeInitialValue = typeof value === "string" ? value : "";

        // 创建编辑器实例 - 使用纯文本模式
        const editorInstance = monaco.editor.create(container, {
          ...PERFORMANCE_OPTIONS,
          value: safeInitialValue,
          language: "plaintext", // 明确设置为纯文本语言，不加载任何语言服务
          theme: "system-prompt-theme",
          readOnly,
        });

        // 🖱️ 禁用 Monaco 的中键多光标/列选择处理，恢复浏览器默认中键滚动
        // 通过捕获阶段拦截中键事件，阻止事件冒泡到 Monaco，但不阻止默认行为
        const editorDomNode = editorInstance.getDomNode();
        // ===== 模拟原生网页中键自动滚动 =====
        const autoScrollActiveRef = { current: false } as { current: boolean };
        const anchorRef = { current: { x: 0, y: 0 } } as {
          current: { x: number; y: number };
        };
        const velocityRef = { current: { vy: 0 } } as {
          current: { vy: number };
        };
        const targetVelocityRef = { current: { vy: 0 } } as {
          current: { vy: number };
        };
        const lastTsRef = { current: 0 } as { current: number };
        const residualRef = { current: 0 } as { current: number };
        const rafRef = { current: 0 } as { current: number };
        const overlayRef = { current: null as HTMLDivElement | null };

        const createOverlay = (x: number, y: number) => {
          const overlay = document.createElement("div");
          overlay.className = monacoStyles["auto-scroll-overlay"];
          overlay.style.left = `${x}px`;
          overlay.style.top = `${y}px`;

          const crossV = document.createElement("div");
          crossV.className = monacoStyles["auto-scroll-cross-v"];

          const crossH = document.createElement("div");
          crossH.className = monacoStyles["auto-scroll-cross-h"];

          const center = document.createElement("div");
          center.className = monacoStyles["auto-scroll-center-dot"];

          overlay.appendChild(crossV);
          overlay.appendChild(crossH);
          overlay.appendChild(center);
          document.body.appendChild(overlay);
          overlayRef.current = overlay;
        };

        const destroyOverlay = () => {
          if (overlayRef.current && overlayRef.current.parentElement) {
            overlayRef.current.parentElement.removeChild(overlayRef.current);
          }
          overlayRef.current = null;
        };

        const stopAutoScroll = () => {
          autoScrollActiveRef.current = false;
          velocityRef.current.vy = 0;
          targetVelocityRef.current.vy = 0;
          residualRef.current = 0;
          lastTsRef.current = 0;
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
          }
          destroyOverlay();
        };

        const tick = () => {
          if (!autoScrollActiveRef.current) return;
          const now = performance.now();
          const dtMs =
            lastTsRef.current === 0 ? 16.67 : now - lastTsRef.current;
          lastTsRef.current = now;

          // 指数平滑，减少抖动（稍强的平滑以改善慢速）
          const smoothingCoeff = 0.06;
          const alpha = 1 - Math.exp(-smoothingCoeff * dtMs);
          velocityRef.current.vy =
            velocityRef.current.vy +
            (targetVelocityRef.current.vy - velocityRef.current.vy) * alpha;

          const editor = editorRef.current;
          if (editor) {
            try {
              const dtNorm = Math.min(2.5, Math.max(0.25, dtMs / 16.67));
              let delta = velocityRef.current.vy * dtNorm;
              if (!Number.isFinite(delta)) delta = 0;

              // 超低速时启用极小阈值，消除细微抖动与漂移
              if (Math.abs(delta) < 0.25) delta = 0;

              if (delta !== 0) {
                const currentTop = editor.getScrollTop();
                editor.setScrollTop(currentTop + delta);
              }
            } catch {}
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        const onMouseMove = (e: MouseEvent) => {
          if (!autoScrollActiveRef.current) return;
          const dy = e.clientY - anchorRef.current.y;
          if (!Number.isFinite(dy)) return;
          // 软死区 + 平滑曲线，避免临界点跳变
          const deadzone = 6; // px
          const range = 240; // 达到最大速度所需的位移
          const maxSpeed = 48; // 60fps 基准的每帧像素

          const mag = Math.max(0, Math.abs(dy) - deadzone);
          let t = Math.min(1, mag / range); // 0..1
          // smoothstep easing（C1 连续）
          t = t * t * (3 - 2 * t);
          let speed = maxSpeed * t;

          // 极小速度阈值，避免慢速时细微跳动
          if (speed < 0.2) speed = 0;
          targetVelocityRef.current.vy = dy >= 0 ? speed : -speed;
        };

        const onAnyMouseDown = () => {
          if (autoScrollActiveRef.current) stopAutoScroll();
        };

        const onKeyDown = (e: KeyboardEvent) => {
          if (e.key === "Escape" && autoScrollActiveRef.current) {
            stopAutoScroll();
          }
        };

        const startAutoScroll = (e: MouseEvent) => {
          autoScrollActiveRef.current = true;
          anchorRef.current = { x: e.clientX, y: e.clientY } as any;
          createOverlay(e.clientX, e.clientY);
          try {
            editorInstance.focus();
          } catch {}
          // 监听全局事件用于控制滚动与退出
          window.addEventListener("mousemove", onMouseMove, true);
          window.addEventListener("mousedown", onAnyMouseDown, true);
          window.addEventListener("auxclick", onAnyMouseDown, true);
          window.addEventListener("keydown", onKeyDown, true);
          window.addEventListener("blur", stopAutoScroll, true);
          // 启动动画循环
          rafRef.current = requestAnimationFrame(tick);
        };

        const middleClickInterceptor = (e: MouseEvent) => {
          if (e && e.button === 1) {
            e.preventDefault();
            if (typeof (e as any).stopImmediatePropagation === "function") {
              (e as any).stopImmediatePropagation();
            } else {
              e.stopPropagation();
            }
            if (autoScrollActiveRef.current) {
              stopAutoScroll();
            } else {
              startAutoScroll(e);
            }
          }
        };
        if (editorDomNode) {
          editorDomNode.addEventListener(
            "mousedown",
            middleClickInterceptor,
            true,
          );
          editorDomNode.addEventListener(
            "auxclick",
            middleClickInterceptor,
            true,
          );
        }

        // 🚫 禁用所有鼠标相关的跳转功能
        editorInstance.updateOptions({
          // 禁用鼠标悬停时的跳转提示
          hover: { enabled: false },
          // 禁用链接点击
          links: false,
          // 禁用定义链接
          definitionLinkOpensInPeek: false,
        });

        // 🚫 禁用编辑器的跳转功能
        editorInstance.getModel()?.updateOptions({
          // 禁用语义验证
          semanticValidation: false,
          // 禁用语法验证
          syntaxValidation: false,
        });

        // 🚫 通过CSS隐藏所有跳转相关的UI元素
        const style = document.createElement("style");
        style.textContent = `
          .monaco-editor .codelens-decoration,
          .monaco-editor .definition-link,
          .monaco-editor .reference-link,
          .monaco-editor .hover-decoration,
          .monaco-editor .squiggly-error,
          .monaco-editor .squiggly-warning,
          .monaco-editor .squiggly-info,
          .monaco-editor .squiggly-hint,
          .monaco-editor .contentWidgets .definition-link,
          .monaco-editor .contentWidgets .reference-link,
          .monaco-editor .contentWidgets .hover-decoration,
          .monaco-editor .decorationsOverviewRuler {
            display: none !important;
            pointer-events: none !important;
          }
        `;
        document.head.appendChild(style);

        // 🚫 完全禁用编辑器的跳转功能
        // 覆盖编辑器的内部方法
        const originalGetAction = editorInstance.getAction;
        if (originalGetAction) {
          editorInstance.getAction = (id: string) => {
            // 禁用所有跳转相关的action
            if (
              id.includes("goto") ||
              id.includes("definition") ||
              id.includes("reference") ||
              id.includes("implementation")
            ) {
              return {
                id,
                label: "",
                run: () => Promise.resolve(),
                enabled: false,
                keybinding: null,
                contextMenuGroupId: "",
                contextMenuOrder: 0,
                isSupported: () => false,
              };
            }
            return originalGetAction.call(editorInstance, id);
          };
        }

        // 再次检查组件是否仍然挂载
        if (!isMounted) {
          editorInstance.dispose();
          return;
        }

        editorRef.current = editorInstance;

        // 监听内容变化
        const disposable = editorInstance.onDidChangeModelContent(() => {
          // 检查组件状态
          if (isDisposedRef.current || !isMounted) return;

          // 避免在程序化设置值时触发onChange
          if (!isInitialValueSet.current) {
            isInitialValueSet.current = true;
            return;
          }

          const currentValue = editorInstance.getValue(); // ✅ Monaco getValue() 总是返回字符串
          onChange(currentValue);
          updateStats(currentValue); // ✅ 这里是安全的
        });

        // 保存disposable与中键拦截器以便清理
        disposableRef.current = {
          contentChange: disposable,
          middleClickInterceptor,
          stopAutoScroll,
          onMouseMove,
          onAnyMouseDown,
          onKeyDown,
        };

        // 初始统计 - 🛡️ 使用安全值
        updateStats(safeInitialValue);

        // 自动聚焦
        if (autoFocus && isMounted) {
          setTimeout(() => {
            if (isMounted && editorInstance && !isDisposedRef.current) {
              editorInstance.focus();
            }
          }, 100);
        }

        // 调用onMount回调
        if (isMounted) {
          onMount?.(editorInstance);
        }

        if (isMounted) {
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Monaco Editor initialization failed:", err);
        setError("编辑器加载失败，请刷新页面重试");
        setIsLoading(false);
      }
    };

    initMonaco();

    return () => {
      isMounted = false;

      // 安全地清理资源，避免Runtime Canceled错误
      if (!isDisposedRef.current) {
        isDisposedRef.current = true;

        // 清理事件监听器
        if (disposableRef.current) {
          try {
            // 清理内容变化监听
            disposableRef.current.contentChange?.dispose?.();
          } catch (e) {
            // 静默处理
          }
          // 清理中键拦截器与自动滚动逻辑
          try {
            if (editorRef.current) {
              const node = editorRef.current.getDomNode();
              const interceptor = disposableRef.current.middleClickInterceptor;
              if (node && interceptor) {
                node.removeEventListener("mousedown", interceptor, true);
                node.removeEventListener("auxclick", interceptor, true);
              }
            }
            // 停止自动滚动并移除全局监听
            try {
              disposableRef.current.stopAutoScroll?.();
            } catch {}
            try {
              window.removeEventListener(
                "mousemove",
                disposableRef.current.onMouseMove,
                true,
              );
              window.removeEventListener(
                "mousedown",
                disposableRef.current.onAnyMouseDown,
                true,
              );
              window.removeEventListener(
                "auxclick",
                disposableRef.current.onAnyMouseDown,
                true,
              );
              window.removeEventListener(
                "keydown",
                disposableRef.current.onKeyDown,
                true,
              );
              window.removeEventListener(
                "blur",
                disposableRef.current.stopAutoScroll,
                true,
              );
            } catch {}
          } catch (e) {
            // 静默处理
          }
          disposableRef.current = null;
        }

        // 清理编辑器实例
        if (editorRef.current) {
          try {
            editorRef.current.dispose();
          } catch (e) {
            // 静默处理disposal错误，避免Runtime Canceled
          }
          editorRef.current = null;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, onMount, readOnly, autoFocus, updateStats]);

  // 处理外部value变化（避免光标跳转）
  const isInitialValueSet = useRef(false);
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();

      // 🛡️ 安全检查：确保value是有效的字符串
      const safeValue = typeof value === "string" ? value : "";

      console.log("🔄 [Monaco] useEffect value变化检查:", {
        isInitialValueSet: isInitialValueSet.current,
        currentValueLength: currentValue?.length || 0,
        propValueLength: safeValue?.length || 0,
        propValueType: typeof value,
        valuesEqual: currentValue === safeValue,
        willUpdate:
          !isInitialValueSet.current ||
          (currentValue !== safeValue && safeValue !== currentValue),
      });

      // 🛡️ 关键修复：如果value是undefined/null且编辑器有内容，不要清空编辑器
      if (
        (typeof value === "undefined" || value === null) &&
        currentValue &&
        currentValue.length > 0 &&
        isInitialValueSet.current
      ) {
        console.warn(
          "⚠️ [Monaco] 检测到value prop为undefined但编辑器有内容，跳过更新避免内容丢失:",
          {
            currentValueLength: currentValue.length,
            propValue: value,
          },
        );
        return;
      }

      // 只在初始化时或值确实不同时才设置值
      if (
        !isInitialValueSet.current ||
        (currentValue !== safeValue && safeValue !== currentValue)
      ) {
        // 保存当前光标位置
        const selection = editorRef.current.getSelection();
        const scrollTop = editorRef.current.getScrollTop();

        try {
          // 🛡️ 安全设置新值
          editorRef.current.setValue(safeValue);

          // 恢复光标位置和滚动位置
          if (selection && isInitialValueSet.current) {
            editorRef.current.setSelection(selection);
            editorRef.current.setScrollTop(scrollTop);
          }

          updateStats(safeValue);
          isInitialValueSet.current = true;
        } catch (error) {
          console.error(
            "Monaco Editor setValue 错误:",
            error,
            "value:",
            value,
            "safeValue:",
            safeValue,
          );
          // 如果设置失败，至少更新统计信息
          updateStats(safeValue);
          isInitialValueSet.current = true;
        }
      }
    }
  }, [value, updateStats]);

  // 获取内存状态提示
  const getMemoryLevel = useMemo(() => {
    const { characters } = stats;
    if (characters > 5000000) return "critical";
    if (characters > 1000000) return "warning";
    return "normal";
  }, [stats]);

  const memoryLevelConfig = {
    normal: { color: "var(--text-color)", message: "" },
    warning: { color: "var(--orange)", message: "⚠️ 大文本模式" },
    critical: { color: "var(--red)", message: "🚨 超大文本模式" },
  };

  if (error) {
    return (
      <div className={`${monacoStyles["monaco-error"]} ${className}`}>
        <div className={monacoStyles["error-icon"]}>⚠️</div>
        <div className={monacoStyles["error-message"]}>{error}</div>
        <div className={monacoStyles["error-suggestion"]}>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${monacoStyles["monaco-container"]} ${monacoStyles["system-prompt-editor"]} ${className}`}
    >
      {/* 🚀 性能状态栏 */}
      <div className={monacoStyles["monaco-status-bar"]}>
        <div className={monacoStyles["monaco-stats"]}>
          <div className={monacoStyles["stat-item"]}>
            字符: {stats.characters.toLocaleString()}
          </div>
          <div className={monacoStyles["stat-item"]}>
            行数: {stats.lines.toLocaleString()}
          </div>
          <div className={monacoStyles["stat-item"]}>
            词数: {stats.words.toLocaleString()}
          </div>
        </div>
        <div
          className={`${monacoStyles["monaco-memory-status"]} ${monacoStyles[getMemoryLevel]}`}
        >
          {memoryLevelConfig[getMemoryLevel].message}
        </div>
      </div>

      {/* 🚀 Monaco Editor 容器 */}
      <div
        ref={containerRef}
        className={monacoStyles["monaco-editor-wrapper"]}
        style={{
          opacity: isLoading ? 0.5 : 1,
        }}
      />

      {/* 🚀 加载指示器 */}
      {isLoading && (
        <div className={monacoStyles["monaco-loading"]}>
          <div className={monacoStyles["loading-spinner"]} />
          <span>正在加载编辑器...</span>
        </div>
      )}
    </div>
  );
};

export default MonacoSystemPromptEditor;
