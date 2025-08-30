import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  useLayoutEffect,
} from "react";
import { flushSync } from "react-dom";
// 使用核心 API 而不是完整的 monaco-editor 包
// 这是一个专门为大文本优化的纯文本编辑器，移除了所有代码编辑特性
// import monaco from "monaco-editor/esm/vs/editor/editor.api";
import styles from "../styles/chat.module.scss";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import monacoStyles from "../styles/monaco-editor.module.scss";
import {
  getMonaco,
  isMonacoLoaded,
  monacoPreloader,
} from "../utils/monaco-preloader";

// 🚀 使用预加载的Monaco Editor，提升加载性能
let Monaco: any = null;
const loadMonaco = async () => {
  // 首先尝试使用预加载的Monaco实例
  if (isMonacoLoaded()) {
    Monaco = getMonaco();
    return Monaco;
  }

  // 如果预加载器正在加载中，等待它完成
  if (monacoPreloader.isMonacoLoading()) {
    Monaco = await monacoPreloader.preload();
    return Monaco;
  }

  // 兜底方案：如果预加载失败或未启动，使用传统的加载方式
  if (!Monaco && typeof window !== "undefined") {
    // 动态导入monaco-editor核心API
    Monaco = await import("monaco-editor");

    // 🚫 关键修复：最根本的解决方案
    // 在Monaco加载时就拦截所有可能导致依赖服务错误的贡献点
    try {
      // 1. 拦截编辑器创建前的贡献点注册
      if (Monaco.editor && Monaco.editor.create) {
        const originalCreate = Monaco.editor.create;
        Monaco.editor.create = function (
          domElement: HTMLElement,
          options: any,
          override: any,
        ) {
          // 强制禁用所有可能导致问题的功能
          const safeOptions = {
            ...options,
            // 禁用所有可能导致依赖服务错误的功能
            codeLens: false,
            inlayHints: { enabled: false },
            dropIntoEditor: { enabled: false },
            lightbulb: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            parameterHints: { enabled: false },
            hover: { enabled: false },
            wordBasedSuggestions: "off",
            suggest: {
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
              enabled: false,
            },
            // 禁用其他可能导致问题的功能
            contextmenu: false,
            links: false,
            mouseWheelZoom: false,
            selectionClipboard: false,
            dragAndDrop: false,
            find: { addExtraSpaceOnTop: false },
            formatOnPaste: false,
            formatOnType: false,
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            autoClosingBrackets: "never",
            autoClosingQuotes: "never",
            autoSurround: "never",
            autoIndent: "none",
            renderValidationDecorations: "off",
            occurrencesHighlight: "off",
            overviewRulerBorder: false,
            definitionLinkOpensInPeek: false,
            semanticValidation: false,
            syntaxValidation: false,
          };

          return originalCreate.call(this, domElement, safeOptions, override);
        };
      }

      // 2. 拦截贡献点实例化系统
      const interceptContributionSystem = () => {
        try {
          // 拦截InstantiationService的_createInstance方法
          if ((Monaco as any).InstantiationService) {
            const InstantiationService = (Monaco as any).InstantiationService;
            if (InstantiationService && InstantiationService.prototype) {
              const originalCreateInstance =
                InstantiationService.prototype.createInstance;
              if (originalCreateInstance) {
                InstantiationService.prototype.createInstance = function (
                  ctor: any,
                  ...args: any[]
                ) {
                  // 检查是否是导致问题的贡献点
                  const ctorName = ctor?.name || ctor?.constructor?.name || "";
                  if (
                    ctorName.includes("CodeLensContribution") ||
                    ctorName.includes("InlayHintsController") ||
                    ctorName.includes("DropIntoEditorController") ||
                    ctorName.includes("SuggestController") ||
                    ctorName.includes("CodeActionController")
                  ) {
                    // 返回一个空的实例，避免依赖服务错误
                    return {
                      dispose: () => {},
                      id: ctorName,
                      enabled: false,
                    };
                  }
                  return originalCreateInstance.call(this, ctor, ...args);
                };
              }
            }
          }

          // 拦截CodeEditorContributions
          if ((Monaco.editor as any).CodeEditorContributions) {
            const CodeEditorContributions = (Monaco.editor as any)
              .CodeEditorContributions;
            if (CodeEditorContributions && CodeEditorContributions.prototype) {
              const originalInstantiateById =
                CodeEditorContributions.prototype._instantiateById;
              if (originalInstantiateById) {
                CodeEditorContributions.prototype._instantiateById = function (
                  id: string,
                  ...args: any[]
                ) {
                  // 阻止这些贡献点被实例化
                  if (
                    id === "codeLens" ||
                    id === "inlayHints" ||
                    id === "dropIntoEditor" ||
                    id === "suggest" ||
                    id === "codeActions" ||
                    id === "parameterHints" ||
                    id === "hover"
                  ) {
                    return {
                      dispose: () => {},
                      id: id,
                      enabled: false,
                    };
                  }
                  return originalInstantiateById.call(this, id, ...args);
                };
              }
            }
          }
        } catch (e) {
          // 忽略拦截贡献点时的警告
        }
      };

      // 3. 延迟执行拦截，确保Monaco完全加载
      setTimeout(interceptContributionSystem, 100);

      // 4. 直接禁用全局贡献点注册
      const disableGlobalContributions = () => {
        try {
          if ((window as any).monaco) {
            const monacoGlobal = (window as any).monaco;

            // 禁用全局服务注册
            if (
              monacoGlobal.services &&
              monacoGlobal.services.ServiceCollection
            ) {
              const ServiceCollection = monacoGlobal.services.ServiceCollection;
              if (ServiceCollection && ServiceCollection.prototype) {
                const originalSet = ServiceCollection.prototype.set;
                if (originalSet) {
                  ServiceCollection.prototype.set = function (
                    serviceId: any,
                    instance: any,
                  ) {
                    // 阻止注册可能导致问题的服务
                    const serviceName =
                      serviceId?._serviceBrand || serviceId?.name || "";
                    if (
                      serviceName.includes("ICodeLensCache") ||
                      serviceName.includes("IInlayHintsCache") ||
                      serviceName.includes("treeViewsDndService") ||
                      serviceName.includes("ISuggestMemories") ||
                      serviceName.includes("actionWidgetService")
                    ) {
                      return this; // 不注册这些服务
                    }
                    return originalSet.call(this, serviceId, instance);
                  };
                }
              }
            }
          }
        } catch (e) {
          // 忽略禁用全局贡献点时的警告
        }
      };

      setTimeout(disableGlobalContributions, 200);
    } catch (e) {
      // 忽略禁用贡献点时的警告
    }

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

interface MonacoEditorProps {
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
const PERFORMANCE_OPTIONS = {
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

  // 🛡️ 功能禁用（减少开销）- 修复依赖服务错误
  codeLens: false, // 禁用CodeLens，避免ICodeLensCache依赖
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
  dragAndDrop: false, // 禁用拖拽功能，避免treeViewsDndService依赖

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
  definitionLinkOpensInPeek: false,

  // 🚫 禁用所有代码操作
  lightbulb: { enabled: false }, // 禁用代码操作，避免actionWidgetService依赖

  // 🚫 禁用所有语义功能
  semanticValidation: false, // 禁用语义验证
  syntaxValidation: false, // 禁用语法验证

  // 🚫 禁用InlayHints，避免IInlayHintsCache依赖
  inlayHints: { enabled: false },

  // 🚫 禁用拖放功能，避免treeViewsDndService依赖
  dropIntoEditor: { enabled: false },
} as unknown as monaco.editor.IStandaloneEditorConstructionOptions;

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ characters: 0, lines: 0, words: 0 });
  const [monacoLoadMethod, setMonacoLoadMethod] = useState<
    "preloaded" | "loading" | "fallback"
  >("fallback");

  // 性能监控
  const updateStats = useCallback((text: string | undefined) => {
    // 安全检查：确保text是有效字符串
    if (typeof text !== "string") {
      setStats({ characters: 0, lines: 0, words: 0 });
      return;
    }

    try {
      const characters = text.length;
      const lines = text.split("\n").length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setStats({ characters, lines, words });
    } catch (error) {
      setStats({ characters: 0, lines: 0, words: 0 });
    }
  }, []);

  // 初始化Monaco Editor
  useEffect(() => {
    let isMounted = true;

    const initMonaco = async () => {
      try {
        console.log("[MonacoEditor] 🔄 开始初始化 Monaco 编辑器");
        // 🔧 确保在开始加载前设置加载状态
        setIsLoading(true);
        console.log("[MonacoEditor] ✅ 设置 isLoading = true");

        // 智能加载策略：优先使用预加载实例
        let monaco: typeof import("monaco-editor");
        console.log("[MonacoEditor] 🔍 检查 Monaco 加载状态...");
        if (isMonacoLoaded()) {
          console.log("[MonacoEditor] 🎯 使用预加载的 Monaco 实例");
          monaco = getMonaco();
          setMonacoLoadMethod("preloaded");
        } else if (monacoPreloader.isMonacoLoading()) {
          console.log("[MonacoEditor] ⏳ Monaco 正在加载中，等待完成...");
          setMonacoLoadMethod("loading");
          monaco = await monacoPreloader.preload();
          console.log("[MonacoEditor] ✅ Monaco 预加载完成");
        } else {
          console.log("[MonacoEditor] 🔄 使用兜底加载方式");
          setMonacoLoadMethod("fallback");
          monaco = await loadMonaco();
          console.log("[MonacoEditor] ✅ Monaco 兜底加载完成");
        }

        // 🔧 关键修复：只有在组件未卸载时才继续初始化
        if (!isMounted) {
          console.warn("[MonacoEditor] 组件已卸载，跳过编辑器初始化");
          const isProduction = process.env.NODE_ENV === "production";
          if (isProduction) {
            flushSync(() => setIsLoading(false));
          } else {
            setIsLoading(false);
          }
          return;
        }

        // 🔧 关键修复：检查容器是否可用
        if (!containerRef.current) {
          console.warn("[MonacoEditor] 容器不可用，跳过编辑器初始化");
          const isProduction = process.env.NODE_ENV === "production";
          if (isProduction) {
            flushSync(() => setIsLoading(false));
          } else {
            setIsLoading(false);
          }
          return;
        }
        console.log("[MonacoEditor] ✅ 容器可用，开始创建编辑器");

        // 🛡️ 确保容器干净（防止"Element already has context attribute"错误）
        const container = containerRef.current;
        console.log("[MonacoEditor] 🧹 清理容器状态");

        // 清理容器的所有子元素和属性
        container.innerHTML = "";

        // 移除可能存在的Monaco相关属性
        const monacoAttributes = Array.from(container.attributes).filter(
          (attr) =>
            (attr as Attr).name.includes("monaco") ||
            (attr as Attr).name.includes("context"),
        );
        monacoAttributes.forEach((attr) => {
          try {
            container.removeAttribute((attr as Attr).name);
          } catch (e) {
            // 忽略移除属性时的错误
          }
        });

        // 🛡️ 确保value是安全的字符串
        const safeInitialValue = typeof value === "string" ? value : "";
        console.log(
          "[MonacoEditor] 📝 准备创建编辑器实例，初始值长度:",
          safeInitialValue.length,
        );

        // 创建编辑器实例 - 使用纯文本模式
        console.log("[MonacoEditor] 🏗️ 创建 Monaco 编辑器实例...");
        const editorInstance = monaco.editor.create(container, {
          ...PERFORMANCE_OPTIONS,
          value: safeInitialValue,
          language: "plaintext", // 明确设置为纯文本语言，不加载任何语言服务
          theme: "system-prompt-theme",
          readOnly,
        });
        console.log("[MonacoEditor] ✅ Monaco 编辑器实例创建成功");

        // 🚫 关键修复：在编辑器创建后立即禁用所有导致依赖服务错误的贡献点
        try {
          // 通过覆盖编辑器的内部方法来禁用这些功能
          const editorModel = editorInstance.getModel();
          if (editorModel) {
            // 禁用语义验证
            editorModel.updateOptions({
              semanticValidation: false,
              syntaxValidation: false,
            } as any);
          }

          // 禁用编辑器的贡献点
          const contributions = (editorInstance as any)._contributions;
          if (contributions) {
            // 禁用CodeLens贡献点
            if (contributions.codeLens) {
              try {
                contributions.codeLens.dispose();
                delete contributions.codeLens;
              } catch (e) {
                // 忽略错误
              }
            }

            // 禁用InlayHints贡献点
            if (contributions.inlayHints) {
              try {
                contributions.inlayHints.dispose();
                delete contributions.inlayHints;
              } catch (e) {
                // 忽略错误
              }
            }

            // 禁用拖放贡献点
            if (contributions.dropIntoEditor) {
              try {
                contributions.dropIntoEditor.dispose();
                delete contributions.dropIntoEditor;
              } catch (e) {
                // 忽略错误
              }
            }

            // 禁用建议贡献点
            if (contributions.suggest) {
              try {
                contributions.suggest.dispose();
                delete contributions.suggest;
              } catch (e) {
                // 忽略错误
              }
            }

            // 禁用代码操作贡献点
            if (contributions.codeActions) {
              try {
                contributions.codeActions.dispose();
                delete contributions.codeActions;
              } catch (e) {
                // 忽略错误
              }
            }
          }
        } catch (e) {
          // Ignore warnings when disabling editor contributions
        }

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
        // 注意：验证选项应该在编辑器配置中设置，而不是模型选项中

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
          .monaco-editor .decorationsOverviewRuler,
          .monaco-editor .codelens-decoration,
          .monaco-editor .inlay-hint,
          .monaco-editor .suggest-widget,
          .monaco-editor .lightbulb-glyph,
          .monaco-editor .drop-into-editor,
          .monaco-editor .code-action-widget,
          .monaco-editor .parameter-hints-widget,
          .monaco-editor .hover-widget,
          .monaco-editor .context-view,
          .monaco-editor .find-widget,
          .monaco-editor .rename-box,
          .monaco-editor .suggest-details,
          .monaco-editor .suggest-details .monaco-list,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label .highlight,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label .highlight .highlight,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label .highlight .highlight .highlight,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label .highlight .highlight .highlight .highlight,
          .monaco-editor .suggest-details .monaco-list .monaco-list-row .monaco-list-row-contents .monaco-list-row-label .monaco-highlighted-label .highlight .highlight .highlight .highlight .highlight {
            display: none !important;
            pointer-events: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            position: absolute !important;
            left: -9999px !important;
            top: -9999px !important;
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
                alias: "",
                metadata: undefined,
                run: () => Promise.resolve(),
                isSupported: () => false,
              };
            }
            return originalGetAction.call(editorInstance, id);
          };
        }

        // 再次检查组件是否仍然挂载
        if (!isMounted) {
          console.warn(
            "[MonacoEditor] 组件在编辑器配置完成后卸载，清理编辑器实例",
          );
          editorInstance.dispose();
          return;
        }

        // 🚀 强制启用粘贴相关的功能
        try {
          console.log("[MonacoEditor] 🔧 强制启用粘贴相关功能");
          editorInstance.updateOptions({
            // 确保粘贴功能可用
            formatOnPaste: false, // 不格式化粘贴内容
            // 启用基本的粘贴支持
          });
        } catch (error) {
          console.warn("[MonacoEditor] 启用粘贴功能时出错:", error);
        }

        console.log("[MonacoEditor] 🎯 保存编辑器实例引用");
        editorRef.current = editorInstance;

        // 🎯 智能记忆系统：记住最大列位置和连续操作状态
        let lastNonEmptyLineColumn = 1; // 记住上一个非空行的列位置
        let maxColumnPosition = 1; // 连续操作中的最大列位置
        let lastArrowKeyTime = 0; // 上次上下键操作的时间戳
        let lastArrowKeyDirection = ""; // 上次上下键的方向
        const CONTINUOUS_OPERATION_THRESHOLD = 500; // 连续操作的时间阈值（毫秒）

        // 🎯 视觉行移动辅助函数
        const getVisualLineInfo = (editor: any, position: any) => {
          try {
            // 获取当前光标的像素位置
            const cursorCoords = editor.getScrolledVisiblePosition(position);

            if (!cursorCoords) {
              return null;
            }

            const lineHeight = editor.getOption(51); // lineHeight

            const currentVisualLineTop = Math.floor(
              cursorCoords.top / lineHeight,
            );

            // 获取可见范围
            const visibleRanges = editor.getVisibleRanges();

            if (!visibleRanges || visibleRanges.length === 0) {
              return null;
            }

            const visibleRange = visibleRanges[0];

            return {
              cursorCoords,
              lineHeight,
              currentVisualLineTop,
              visibleRange,
            };
          } catch (error) {
            return null;
          }
        };

        // 计算目标视觉行位置
        const calculateVisualLinePosition = (
          editor: any,
          currentPosition: any,
          direction: string,
          effectiveOffset: number,
        ) => {
          try {
            const visualInfo = getVisualLineInfo(editor, currentPosition);
            if (!visualInfo) {
              // 直接在这里实现逻辑行移动
              const model = editor.getModel();
              if (!model) return null;

              let targetLineNumber: number;
              if (direction === "ArrowUp") {
                if (currentPosition.lineNumber <= 1) return null;
                targetLineNumber = currentPosition.lineNumber - 1;
              } else {
                const maxLineNumber = model.getLineCount();
                if (currentPosition.lineNumber >= maxLineNumber) return null;
                targetLineNumber = currentPosition.lineNumber + 1;
              }

              const targetLineContent = model.getLineContent(targetLineNumber);
              const targetLineLength = targetLineContent.length;
              const targetColumn = Math.max(
                1,
                Math.min(effectiveOffset + 1, targetLineLength + 1),
              );

              return { lineNumber: targetLineNumber, column: targetColumn };
            }

            const { cursorCoords } = visualInfo;
            // 1) 获取可靠的行高
            let resolvedLineHeight: number | undefined = undefined;
            try {
              const opt = (monaco as any).editor.EditorOption
                ? editor.getOption(
                    (monaco as any).editor.EditorOption.lineHeight,
                  )
                : undefined;
              if (typeof opt === "number" && isFinite(opt)) {
                resolvedLineHeight = opt;
              }
            } catch {}
            if (!resolvedLineHeight) {
              const cfg = (editor as any).getConfiguration?.();
              if (cfg && typeof cfg.lineHeight === "number") {
                resolvedLineHeight = cfg.lineHeight;
              }
            }
            if (!resolvedLineHeight) {
              resolvedLineHeight = 22; // 安全兜底
            }

            // 2) 计算内容坐标下的目标像素
            const layoutInfo = editor.getLayoutInfo();
            const scrollTop = editor.getScrollTop();
            const scrollHeight =
              editor.getScrollHeight?.() ??
              scrollTop + (layoutInfo?.height || 0);
            const contentWidth = layoutInfo?.contentWidth || 0;
            const clamp = (v: number, lo: number, hi: number) =>
              Math.max(lo, Math.min(hi, v));

            const xContent = clamp(
              cursorCoords.left,
              0,
              Math.max(0, contentWidth - 1),
            );
            const yContent = clamp(
              cursorCoords.top +
                (direction === "ArrowUp"
                  ? -resolvedLineHeight
                  : resolvedLineHeight),
              0,
              Math.max(0, scrollHeight - 1),
            );

            // 3) 首选：内容坐标命中
            try {
              const pos = editor.getPositionAt(xContent, yContent);
              if (pos) return pos;
            } catch {}

            // 4) 兜底：客户端坐标命中
            try {
              const rect = editor.getDomNode().getBoundingClientRect();
              const clientX =
                rect.left + (layoutInfo?.contentLeft || 0) + xContent;
              const clientY = rect.top + (yContent - scrollTop);
              const hit = (editor as any).getTargetAtClientPoint?.(
                clientX,
                clientY,
              );
              if (hit && hit.position) return hit.position;
            } catch {}

            // 5) 再兜底：如果目标位置可能在视口外，尝试 reveal 后再用内容坐标重试一次
            try {
              editor.revealPositionInCenterIfOutsideViewport?.(currentPosition);
              const pos2 = editor.getPositionAt(xContent, yContent);
              if (pos2) return pos2;
            } catch {}

            // 如果上面的方法失败，降级到逻辑行移动

            // 直接在这里实现逻辑行移动
            const model = editor.getModel();
            if (!model) return null;

            let targetLineNumber: number;
            if (direction === "ArrowUp") {
              if (currentPosition.lineNumber <= 1) return null;
              targetLineNumber = currentPosition.lineNumber - 1;
            } else {
              const maxLineNumber = model.getLineCount();
              if (currentPosition.lineNumber >= maxLineNumber) return null;
              targetLineNumber = currentPosition.lineNumber + 1;
            }

            const targetLineContent = model.getLineContent(targetLineNumber);
            const targetLineLength = targetLineContent.length;
            const targetColumn = Math.max(
              1,
              Math.min(effectiveOffset + 1, targetLineLength + 1),
            );

            return { lineNumber: targetLineNumber, column: targetColumn };
          } catch (error) {
            // 降级到逻辑行移动
            // 直接在这里实现逻辑行移动
            const model = editor.getModel();
            if (!model) return null;

            let targetLineNumber: number;
            if (direction === "ArrowUp") {
              if (currentPosition.lineNumber <= 1) return null;
              targetLineNumber = currentPosition.lineNumber - 1;
            } else {
              const maxLineNumber = model.getLineCount();
              if (currentPosition.lineNumber >= maxLineNumber) return null;
              targetLineNumber = currentPosition.lineNumber + 1;
            }

            const targetLineContent = model.getLineContent(targetLineNumber);
            const targetLineLength = targetLineContent.length;
            const targetColumn = Math.max(
              1,
              Math.min(effectiveOffset + 1, targetLineLength + 1),
            );

            return { lineNumber: targetLineNumber, column: targetColumn };
          }
        };

        // 🔧 强化修复：全面阻止重复光标移动的补丁
        const applyDuplicateCursorMovementFix = () => {
          // 🎯 全局光标移动拦截器
          let lastMoveTime = 0;
          let lastMovePosition = { lineNumber: 0, column: 0 };
          let moveBlockCount = 0;

          const shouldBlockMove = (
            position: any,
            source: string = "unknown",
          ) => {
            const currentTime = performance.now();
            const timeDiff = currentTime - lastMoveTime;

            // 如果是50ms内的重复移动到相邻位置，阻止它
            const isDuplicateMove =
              timeDiff < 50 &&
              Math.abs(position.lineNumber - lastMovePosition.lineNumber) <=
                1 &&
              Math.abs(position.column - lastMovePosition.column) <= 2 &&
              !(
                position.lineNumber === lastMovePosition.lineNumber &&
                position.column === lastMovePosition.column
              );

            if (isDuplicateMove) {
              moveBlockCount++;
              return true; // 阻止移动
            }

            // 记录移动信息
            lastMoveTime = currentTime;
            lastMovePosition = {
              lineNumber: position.lineNumber,
              column: position.column,
            };

            return false; // 允许移动
          };

          // 1. 拦截 setPosition 方法
          const originalSetPosition = (editorInstance as any).setPosition;
          if (originalSetPosition) {
            (editorInstance as any).setPosition = function (position: any) {
              if (shouldBlockMove(position, "setPosition")) {
                return; // 阻止重复移动
              }
              return originalSetPosition.call(this, position);
            };
          }

          // 2. 拦截 reveal 方法
          const originalRevealPosition = (editorInstance as any).revealPosition;
          if (originalRevealPosition) {
            (editorInstance as any).revealPosition = function (
              position: any,
              ...args: any[]
            ) {
              if (shouldBlockMove(position, "revealPosition")) {
                return; // 阻止重复移动
              }
              return originalRevealPosition.call(this, position, ...args);
            };
          }

          // 3. 拦截光标选择设置
          const originalSetSelection = (editorInstance as any).setSelection;
          if (originalSetSelection) {
            (editorInstance as any).setSelection = function (selection: any) {
              if (selection && selection.startLineNumber) {
                if (
                  shouldBlockMove(
                    {
                      lineNumber: selection.startLineNumber,
                      column: selection.startColumn,
                    },
                    "setSelection",
                  )
                ) {
                  return; // 阻止重复移动
                }
              }
              return originalSetSelection.call(this, selection);
            };
          }

          // 4. 拦截光标选择变化事件的触发
          const originalCursor = (editorInstance as any)._cursor;
          if (originalCursor) {
            // 尝试拦截光标控制器的核心方法
            if (originalCursor.setSelections) {
              const originalSetSelections = originalCursor.setSelections;
              originalCursor.setSelections = function (selections: any) {
                if (selections && selections[0]) {
                  const selection = selections[0];
                  if (
                    shouldBlockMove(
                      {
                        lineNumber: selection.startLineNumber,
                        column: selection.startColumn,
                      },
                      "cursor.setSelections",
                    )
                  ) {
                    return; // 阻止重复移动
                  }
                }
                return originalSetSelections.call(this, selections);
              };
            }
          }

          // 5. 拦截更深层的视图控制器
          const originalController = (editorInstance as any)._contributions
            ?.viewController;
          if (originalController && originalController.moveTo) {
            const originalMoveTo = originalController.moveTo;
            originalController.moveTo = function (position: any) {
              if (shouldBlockMove(position, "viewController.moveTo")) {
                return; // 阻止重复移动
              }
              return originalMoveTo.call(this, position);
            };
          }

          // 🚨 修正版键盘事件修复 - 区分真正的重复事件 vs 同一事件的不同阶段
          let lastKeyTime = 0;
          let lastKeyCode = 0;
          let lastKeyStage = "";
          let currentKeyEventId = 0; // 用于标识同一个按键事件
          let processedKeyEvents = new Set(); // 记录已处理的事件

          const keyboardEventFilter = (
            e: KeyboardEvent,
            stage: string = "unknown",
          ) => {
            const currentTime = performance.now();
            const timeDiff = currentTime - lastKeyTime;

            // 🎯 为每个原生事件分配唯一ID（基于时间戳和keyCode）
            const eventId = `${e.timeStamp}_${e.keyCode}_${e.key}`;

            // 🎯 检测所有可能导致重复移动的键
            const isNavigationOrDeleteKey = [
              "ArrowRight",
              "ArrowLeft",
              "ArrowUp",
              "ArrowDown",
              "Backspace",
              "Delete",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(e.key);

            if (isNavigationOrDeleteKey) {
              // 🚨 如果这是一个已经处理过的事件，直接阻止
              if (processedKeyEvents.has(eventId)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return false;
              }

              // 🚨 检测真正的重复按键（不同的事件，但是时间很近且keyCode相同）
              const isRealDuplicateKey =
                timeDiff < 100 && // 100ms内
                lastKeyCode === e.keyCode &&
                lastKeyStage !== "" && // 确保不是第一次
                !processedKeyEvents.has(eventId); // 且不是同一个事件

              if (isRealDuplicateKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return false;
              }

              // 🚨 检测各种键的异常keyCode情况
              const expectedKeyCodes: { [key: string]: number } = {
                ArrowRight: 39,
                ArrowLeft: 37,
                ArrowUp: 38,
                ArrowDown: 40,
                Backspace: 8,
                Delete: 46,
                Home: 36,
                End: 35,
                PageUp: 33,
                PageDown: 34,
              };

              const expectedKeyCode = expectedKeyCodes[e.key];
              if (expectedKeyCode && e.keyCode !== expectedKeyCode) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return false;
              }

              // ✅ 记录这个事件为已处理，防止在其他阶段重复处理
              processedKeyEvents.add(eventId);

              // 清理旧的事件记录（防止内存泄漏）
              if (processedKeyEvents.size > 20) {
                processedKeyEvents.clear();
              }
            }

            // 更新最后按键信息
            lastKeyTime = currentTime;
            lastKeyCode = e.keyCode;
            lastKeyStage = stage;
            return true;
          };

          // 🎯 简化为单点拦截策略 - 只在最早阶段进行重复检测
          const editorDomNode = editorInstance.getDomNode();
          if (editorDomNode) {
            // 🚨 选择性接管策略：只拦截问题键，保留上下键原生视觉行移动
            editorDomNode.addEventListener(
              "keydown",
              (e: Event) => {
                const keyEvent = e as KeyboardEvent;
                const currentTime = performance.now();
                const timeDiff = currentTime - lastKeyTime;

                // 🎯 只拦截确认有问题的键，让上下键正常传递给Monaco
                const isTargetKey = [
                  "ArrowRight", // 有keyCode异常问题
                  "ArrowLeft", // 有重复移动问题
                  "Backspace", // 有重复删除问题
                  "Delete", // 可能有重复删除问题
                  "Home", // 简单的行首跳转
                  "End", // 简单的行尾跳转
                ].includes(keyEvent.key);

                if (isTargetKey) {
                  // 🚨 检测重复事件
                  const isDuplicateEvent = timeDiff < 100 && timeDiff > 0;

                  if (isDuplicateEvent) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return false;
                  }

                  // 🎯 完全阻止原生事件，自行处理

                  e.preventDefault();
                  e.stopImmediatePropagation();

                  // 🎯 自行实现光标移动逻辑
                  const currentPosition = editorInstance.getPosition();
                  if (!currentPosition) {
                    return false;
                  }

                  let newPosition: {
                    lineNumber: number;
                    column: number;
                  } | null = null;
                  const model = editorInstance.getModel();
                  if (!model) {
                    return false;
                  }

                  const maxLineNumber = model.getLineCount();
                  const currentLineLength = model.getLineLength(
                    currentPosition.lineNumber,
                  );
                  let handledKeyCount = (window as any)._monacoKeyCount || 0;
                  (window as any)._monacoKeyCount = ++handledKeyCount;

                  switch (keyEvent.key) {
                    case "ArrowRight":
                      if (currentPosition.column <= currentLineLength) {
                        newPosition = {
                          lineNumber: currentPosition.lineNumber,
                          column: currentPosition.column + 1,
                        };
                      } else if (currentPosition.lineNumber < maxLineNumber) {
                        // 移动到下一行开头
                        newPosition = {
                          lineNumber: currentPosition.lineNumber + 1,
                          column: 1,
                        };
                      }
                      break;

                    case "ArrowLeft":
                      if (currentPosition.column > 1) {
                        newPosition = {
                          lineNumber: currentPosition.lineNumber,
                          column: currentPosition.column - 1,
                        };
                      } else if (currentPosition.lineNumber > 1) {
                        // 移动到上一行末尾
                        const prevLineLength = model.getLineLength(
                          currentPosition.lineNumber - 1,
                        );
                        newPosition = {
                          lineNumber: currentPosition.lineNumber - 1,
                          column: prevLineLength + 1,
                        };
                      }
                      break;

                    // 上下键已经被提前处理，不会到达这里

                    case "Home":
                      newPosition = {
                        lineNumber: currentPosition.lineNumber,
                        column: 1,
                      };
                      break;

                    case "End":
                      newPosition = {
                        lineNumber: currentPosition.lineNumber,
                        column: currentLineLength + 1,
                      };
                      break;

                    case "Backspace":
                      // 检查是否有选中文本
                      const selection = editorInstance.getSelection();
                      if (selection && !selection.isEmpty()) {
                        // 如果有选中文本，删除选中的内容
                        editorInstance.executeEdits("backspace", [
                          {
                            range: selection,
                            text: "",
                          },
                        ]);

                        // 光标移动到选择区域的开始位置
                        newPosition = {
                          lineNumber: selection.startLineNumber,
                          column: selection.startColumn,
                        };
                      } else if (currentPosition.column > 1) {
                        // 删除当前位置前的字符
                        const range = {
                          startLineNumber: currentPosition.lineNumber,
                          startColumn: currentPosition.column - 1,
                          endLineNumber: currentPosition.lineNumber,
                          endColumn: currentPosition.column,
                        };

                        editorInstance.executeEdits("backspace", [
                          {
                            range: range,
                            text: "",
                          },
                        ]);

                        newPosition = {
                          lineNumber: currentPosition.lineNumber,
                          column: currentPosition.column - 1,
                        };
                      } else if (currentPosition.lineNumber > 1) {
                        // 删除换行符，合并到上一行
                        const prevLineLength = model.getLineLength(
                          currentPosition.lineNumber - 1,
                        );
                        const range = {
                          startLineNumber: currentPosition.lineNumber - 1,
                          startColumn: prevLineLength + 1,
                          endLineNumber: currentPosition.lineNumber,
                          endColumn: 1,
                        };

                        editorInstance.executeEdits("backspace", [
                          {
                            range: range,
                            text: "",
                          },
                        ]);

                        newPosition = {
                          lineNumber: currentPosition.lineNumber - 1,
                          column: prevLineLength + 1,
                        };
                      }
                      break;

                    case "Delete":
                      if (currentPosition.column <= currentLineLength) {
                        // 删除当前位置的字符
                        const range = {
                          startLineNumber: currentPosition.lineNumber,
                          startColumn: currentPosition.column,
                          endLineNumber: currentPosition.lineNumber,
                          endColumn: currentPosition.column + 1,
                        };

                        editorInstance.executeEdits("delete", [
                          {
                            range: range,
                            text: "",
                          },
                        ]);
                        // Delete操作后光标位置不变
                        newPosition = currentPosition;
                      } else if (currentPosition.lineNumber < maxLineNumber) {
                        // 删除换行符，合并下一行
                        const range = {
                          startLineNumber: currentPosition.lineNumber,
                          startColumn: currentPosition.column,
                          endLineNumber: currentPosition.lineNumber + 1,
                          endColumn: 1,
                        };

                        editorInstance.executeEdits("delete", [
                          {
                            range: range,
                            text: "",
                          },
                        ]);
                        newPosition = currentPosition;
                      }
                      break;
                  }

                  // 🎯 设置新的光标位置
                  if (
                    newPosition &&
                    (newPosition.lineNumber !== currentPosition.lineNumber ||
                      newPosition.column !== currentPosition.column)
                  ) {
                    // 临时禁用我们的拦截器，避免递归
                    const position = newPosition; // 确保类型安全
                    setTimeout(() => {
                      editorInstance.setPosition(position);
                      editorInstance.revealPosition(position);
                    }, 1);
                  }

                  lastKeyTime = currentTime;
                  return false;
                }

                // 非目标键，允许正常传播
                return true;
              },
              true, // 捕获阶段，确保最早拦截
            );
          }

          // 🎯 修复Monaco内部事件的异常keyCode
          const originalOnKeyDown = (editorInstance as any).onKeyDown;
          if (originalOnKeyDown) {
            (editorInstance as any).onKeyDown = function (keyboardEvent: any) {
              const browserEvent = keyboardEvent.browserEvent;

              // 🚨 检测并修复异常的keyCode
              if (browserEvent) {
                const expectedKeyCodes: { [key: string]: number } = {
                  ArrowRight: 39,
                  ArrowLeft: 37,
                  ArrowUp: 38,
                  ArrowDown: 40,
                  Backspace: 8,
                  Delete: 46,
                  Home: 36,
                  End: 35,
                  PageUp: 33,
                  PageDown: 34,
                };

                const expectedKeyCode = expectedKeyCodes[browserEvent.key];

                // 如果Monaco接收到的keyCode与浏览器原生keyCode不一致，修复它
                if (
                  expectedKeyCode &&
                  keyboardEvent.keyCode !== expectedKeyCode
                ) {
                  // 修正keyCode
                  keyboardEvent.keyCode = expectedKeyCode;
                }

                // 🚨 如果是特定的异常组合，直接阻止
                const isProblematicEvent =
                  (browserEvent.key === "ArrowRight" &&
                    keyboardEvent.keyCode === 17) ||
                  (browserEvent.key === "ArrowLeft" &&
                    keyboardEvent.keyCode === 15) ||
                  (browserEvent.key === "Backspace" &&
                    keyboardEvent.keyCode === 1);

                if (isProblematicEvent) {
                  return; // 直接阻止这个事件
                }
              }

              // 继续处理修复后的事件
              return originalOnKeyDown.call(this, keyboardEvent);
            };
          }
        };

        // 延迟应用修复补丁，确保Monaco完全初始化
        setTimeout(() => {
          try {
            applyDuplicateCursorMovementFix();
          } catch (error) {}
        }, 500);

        const debugDisposables = null;

        // 监听内容变化

        const disposable = editorInstance.onDidChangeModelContent((e: any) => {
          // 检查组件状态
          if (isDisposedRef.current || !isMounted) return;

          // 避免在程序化设置值时触发onChange
          if (!isInitialValueSet.current) {
            isInitialValueSet.current = true;
            return;
          }

          const currentValue = editorInstance.getValue(); // ✅ Monaco getValue() 总是返回字符串

          if (onChange) {
            try {
              onChange(currentValue);
            } catch (error) {
              console.error(
                "🔧 [MonacoEditor] DEBUG: onChange call failed:",
                error,
              );
            }
          } else {
            console.warn(
              "🔧 [MonacoEditor] DEBUG: onChange prop is not provided!",
            );
          }

          updateStats(currentValue); // ✅ 这里是安全的
        });

        // 保存disposable与中键拦截器以便清理
        disposableRef.current = {
          contentChange: disposable,
          debugDisposables: debugDisposables,
          middleClickInterceptor,
          stopAutoScroll,
          onMouseMove,
          onAnyMouseDown,
          onKeyDown,
        };

        // 初始统计 - 🛡️ 使用安全值
        updateStats(safeInitialValue);

        // 自动聚焦 - 优化聚焦逻辑，确保编辑器完全准备好
        if (autoFocus && isMounted) {
          // 使用多个时间点尝试聚焦，确保成功
          const focusEditor = () => {
            if (isMounted && editorInstance && !isDisposedRef.current) {
              try {
                // 检查 DOM 节点是否完全准备好
                const domNode = editorInstance.getDomNode();
                if (
                  domNode &&
                  domNode.offsetHeight > 0 &&
                  domNode.offsetWidth > 0
                ) {
                  editorInstance.focus();
                  return true; // 聚焦成功
                } else {
                  return false; // 聚焦失败
                }
              } catch (error) {
                return false;
              }
            }
            return false;
          };

          // 立即尝试聚焦
          if (focusEditor()) return;

          // 延迟 50ms 再次尝试（处理快速渲染情况）
          setTimeout(() => {
            if (focusEditor()) return;

            // 延迟 150ms 再次尝试（处理慢速渲染情况）
            setTimeout(() => {
              if (focusEditor()) return;

              // 延迟 300ms 最后尝试（处理最慢的渲染情况）
              setTimeout(focusEditor, 150);
            }, 100);
          }, 50);
        }

        // 调用onMount回调
        if (isMounted) {
          try {
            console.log("[MonacoEditor] 📞 准备调用 onMount 回调");
            onMount?.(editorInstance);
            console.log("[MonacoEditor] ✅ onMount 回调调用完成");
          } catch (error) {
            console.error("[MonacoEditor] ❌ onMount 回调调用失败:", error);
          }
        }

        // 🚀 立即设置粘贴事件监听器的准备工作（如果有的话）
        if (isMounted) {
          console.log("[MonacoEditor] ⏱️ 设置粘贴监听器准备工作的定时器");
          // 延迟一小段时间，确保Monaco的DOM完全就绪
          setTimeout(() => {
            if (isMounted && editorInstance) {
              console.log(
                "[MonacoEditor] 🎯 编辑器DOM就绪，准备设置粘贴监听器",
              );
              // 这里只是记录状态，实际的监听器设置在monaco-message-editor中处理
              console.log("[MonacoEditor] 📋 粘贴监听器准备工作完成");
            } else {
              console.warn(
                "[MonacoEditor] ⚠️ 粘贴监听器准备工作跳过 - 组件已卸载或编辑器不存在",
              );
            }
          }, 100);
        }

        // 设置 ResizeObserver 监听容器大小变化，在变化后尝试聚焦
        if (autoFocus && containerRef.current) {
          try {
            console.log("[MonacoEditor] 🔍 设置 ResizeObserver");
            resizeObserverRef.current = new ResizeObserver(() => {
              console.log("[MonacoEditor] 📏 ResizeObserver 触发，尝试聚焦");
              if (isMounted && editorInstance && !isDisposedRef.current) {
                setTimeout(() => {
                  try {
                    console.log("[MonacoEditor] 🎯 ResizeObserver 触发聚焦");
                    editorInstance.focus();
                  } catch (error) {
                    console.warn(
                      "[MonacoEditor] ⚠️ ResizeObserver 聚焦失败:",
                      error,
                    );
                  }
                }, 100);
              }
            });
            resizeObserverRef.current.observe(containerRef.current);
            console.log("[MonacoEditor] ✅ ResizeObserver 设置完成");
          } catch (error) {
            console.warn("[MonacoEditor] ⚠️ ResizeObserver 设置失败:", error);
          }
        }

        // 在编辑器布局完成后再次尝试聚焦（处理布局延迟的情况）
        if (autoFocus && isMounted) {
          console.log("[MonacoEditor] 🎯 开始聚焦尝试流程");
          // 使用 requestAnimationFrame 确保在下一帧渲染时聚焦
          console.log("[MonacoEditor] ⏱️ 设置 requestAnimationFrame 聚焦");
          requestAnimationFrame(() => {
            console.log(
              "[MonacoEditor] 🎬 requestAnimationFrame 触发，开始聚焦",
            );
            if (isMounted && editorInstance && !isDisposedRef.current) {
              try {
                // 强制重新布局并聚焦
                console.log("[MonacoEditor] 🔧 执行布局和聚焦");
                editorInstance.layout();
                editorInstance.focus();
                console.log("[MonacoEditor] ✅ requestAnimationFrame 聚焦完成");
              } catch (error) {
                console.warn(
                  "[MonacoEditor] ⚠️ requestAnimationFrame 聚焦失败:",
                  error,
                );
              }
            } else {
              console.warn(
                "[MonacoEditor] ⚠️ requestAnimationFrame 跳过聚焦 - 条件不满足",
              );
            }
          });

          // 延迟 200ms 再次尝试（处理布局延迟的情况）
          console.log("[MonacoEditor] ⏱️ 设置 200ms 延迟聚焦定时器");
          setTimeout(() => {
            console.log("[MonacoEditor] ⏰ 200ms 延迟聚焦定时器触发");
            if (isMounted && editorInstance && !isDisposedRef.current) {
              try {
                // 强制重新布局并聚焦
                console.log("[MonacoEditor] 🔧 执行 200ms 延迟布局和聚焦");
                editorInstance.layout();
                editorInstance.focus();
                console.log("[MonacoEditor] ✅ 200ms 延迟聚焦完成");
              } catch (error) {
                console.warn("[MonacoEditor] ⚠️ 200ms 延迟聚焦失败:", error);
              }
            } else {
              console.warn("[MonacoEditor] ⚠️ 200ms 延迟聚焦跳过 - 条件不满足");
            }
          }, 200);
        } else {
          console.log(
            "[MonacoEditor] ℹ️ 跳过聚焦流程 - autoFocus 或 isMounted 不满足条件",
          );
        }

        // 🎯 确保编辑器加载完成后正确更新状态
        if (isMounted) {
          console.log("[MonacoEditor] 🎯 ===== 编辑器加载完成流程开始 =====");
          // 🔧 立即更新加载状态 - 强制同步更新
          console.log("[MonacoEditor] 🎯 准备更新加载状态...");
          // 在生产环境中使用 flushSync 强制同步更新
          const isProduction = process.env.NODE_ENV === "production";
          if (isProduction) {
            console.log(
              "[MonacoEditor] 🔧 生产环境：使用 flushSync 强制同步更新",
            );
            flushSync(() => {
              setIsLoading(false);
            });
          } else {
            setIsLoading(false);
          }
          console.log(
            "[MonacoEditor] ✅ 编辑器初始化完成，设置加载状态为 false",
          );

          // 🔧 生产环境特殊处理：强制同步状态更新
          if (isProduction) {
            console.log("[MonacoEditor] 🎯 生产环境检测到，执行特殊状态同步");
            // 使用 requestAnimationFrame 确保在下一帧更新
            console.log(
              "[MonacoEditor] ⏱️ 设置 requestAnimationFrame 状态同步",
            );
            requestAnimationFrame(() => {
              console.log(
                "[MonacoEditor] 🎬 requestAnimationFrame 状态同步触发",
              );
              if (isMounted && editorRef.current) {
                flushSync(() => setIsLoading(false));
                console.log("[MonacoEditor] ✅ 生产环境状态同步完成");
              } else {
                console.warn(
                  "[MonacoEditor] ⚠️ requestAnimationFrame 状态同步跳过 - 条件不满足",
                );
              }
            });
          }

          // 🔧 额外确保：延迟确认编辑器确实可用
          console.log("[MonacoEditor] ⏱️ 设置 100ms 延迟确认定时器");
          setTimeout(() => {
            console.log("[MonacoEditor] ⏰ 100ms 延迟确认定时器触发");
            if (isMounted && editorInstance && !isDisposedRef.current) {
              const isProductionEnv = process.env.NODE_ENV === "production";
              if (isProductionEnv) {
                flushSync(() => setIsLoading(false));
              } else {
                setIsLoading(false);
              }
              console.log(
                "[MonacoEditor] 延迟确认：编辑器可用，继续设置加载状态为 false",
              );
              // 🎯 最后确认：确保编辑器完全就绪
              console.log("[MonacoEditor] ⏱️ 设置最终确认定时器 (200ms)");
              setTimeout(() => {
                console.log("[MonacoEditor] 🎯 最终确认定时器触发");
                if (isMounted && editorInstance && !isDisposedRef.current) {
                  if (isProductionEnv) {
                    flushSync(() => setIsLoading(false));
                  } else {
                    setIsLoading(false);
                  }
                  console.log("[MonacoEditor] 最终确认：编辑器完全就绪");
                  console.log(
                    "[MonacoEditor] 🎉 ===== 编辑器加载完成流程结束 =====",
                  );
                } else {
                  console.warn(
                    "[MonacoEditor] 最终确认失败：编辑器可能已被销毁",
                  );
                }
              }, 200);
            } else {
              console.warn(
                "[MonacoEditor] 延迟确认失败：组件已卸载或编辑器不可用",
              );
            }
          }, 100);
        } else {
          console.warn("[MonacoEditor] 无法更新加载状态：组件已卸载");
        }
      } catch (err) {
        console.error("[MonacoEditor] 编辑器初始化失败:", err);
        setError("编辑器加载失败，请刷新页面重试");
        const isProduction = process.env.NODE_ENV === "production";
        if (isProduction) {
          flushSync(() => setIsLoading(false));
        } else {
          setIsLoading(false);
        }

        // 🔧 关键修复：确保即使在异常情况下也能正确更新状态
        setTimeout(() => {
          if (isMounted) {
            const isProduction = process.env.NODE_ENV === "production";
            if (isProduction) {
              flushSync(() => setIsLoading(false));
            } else {
              setIsLoading(false);
            }
            console.log("[MonacoEditor] 异常处理：确认加载状态为 false");
          }
        }, 100);
      }
    };

    initMonaco();

    return () => {
      isMounted = false;

      // 🔧 防止在组件卸载时更新状态
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        flushSync(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }

      // 🚫 组件卸载时的最终清理
      try {
        // 清理全局Monaco状态
        if ((window as any).monaco) {
          const monacoGlobal = (window as any).monaco;
          // 清理可能存在的全局缓存和状态
          if (monacoGlobal.services) {
            Object.keys(monacoGlobal.services).forEach((key) => {
              try {
                if (
                  monacoGlobal.services[key] &&
                  typeof monacoGlobal.services[key].dispose === "function"
                ) {
                  monacoGlobal.services[key].dispose();
                }
              } catch (e) {
                // 忽略清理错误
              }
            });
          }
        }
      } catch (e) {
        // 忽略清理错误
      }

      // 安全地清理资源，避免Runtime Canceled错误
      if (!isDisposedRef.current) {
        isDisposedRef.current = true;

        // 清理 ResizeObserver
        if (resizeObserverRef.current) {
          try {
            resizeObserverRef.current.disconnect();
            resizeObserverRef.current = null;
          } catch (error) {
            // 忽略清理错误
          }
        }

        // 清理事件监听器
        if (disposableRef.current) {
          try {
            // 清理内容变化监听
            disposableRef.current.contentChange?.dispose?.();

            // 清理调试监听器
            if (disposableRef.current.debugDisposables) {
              try {
                disposableRef.current.debugDisposables.cursorDisposable?.dispose?.();
                disposableRef.current.debugDisposables.selectionDisposable?.dispose?.();
                disposableRef.current.debugDisposables.keyDownDisposable?.dispose?.();
                disposableRef.current.debugDisposables.keyUpDisposable?.dispose?.();
              } catch (e) {
                // 忽略清理错误
              }
            }
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
            // 🚫 在销毁编辑器之前，确保所有贡献点都被清理
            const contributions = (editorRef.current as any)._contributions;
            if (contributions) {
              // 强制清理所有贡献点
              Object.keys(contributions).forEach((key) => {
                try {
                  if (
                    contributions[key] &&
                    typeof contributions[key].dispose === "function"
                  ) {
                    contributions[key].dispose();
                  }
                } catch (e) {
                  // 忽略清理错误
                }
              });
            }

            // 清理DOM节点
            const domNode = editorRef.current.getDomNode();
            if (domNode && domNode.parentNode) {
              // 移除所有可能存在的Monaco相关属性
              const allAttributes = Array.from(domNode.attributes);
              allAttributes.forEach((attr) => {
                if (
                  (attr as Attr).name.includes("monaco") ||
                  (attr as Attr).name.includes("context") ||
                  (attr as Attr).name.includes("data")
                ) {
                  try {
                    domNode.removeAttribute((attr as Attr).name);
                  } catch (e) {
                    // 忽略错误
                  }
                }
              });

              // 清空DOM节点内容
              domNode.innerHTML = "";
            }

            // 销毁编辑器
            editorRef.current.dispose();

            // 额外清理：确保全局Monaco状态也被清理
            try {
              if ((window as any).monaco) {
                const monacoGlobal = (window as any).monaco;
                // 清理可能存在的全局缓存
                if (
                  monacoGlobal.services &&
                  monacoGlobal.services.StaticServices
                ) {
                  delete monacoGlobal.services.StaticServices;
                }
              }
            } catch (e) {
              // 忽略全局清理错误
            }
          } catch (e) {
            // 静默处理disposal错误，避免Runtime Canceled
          }
          editorRef.current = null;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, readOnly, autoFocus, updateStats]); // 移除 onMount 依赖，避免不必要的重新初始化

  // 处理外部value变化（避免光标跳转）
  const isInitialValueSet = useRef(false);
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();

      // 🛡️ 安全检查：确保value是有效的字符串
      const safeValue = typeof value === "string" ? value : "";

      // 🛡️ 关键修复：如果value是undefined/null且编辑器有内容，不要清空编辑器
      if (
        (typeof value === "undefined" || value === null) &&
        currentValue &&
        currentValue.length > 0 &&
        isInitialValueSet.current
      ) {
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

          // 在值更新后，如果启用了自动聚焦，尝试聚焦编辑器
          if (autoFocus) {
            setTimeout(() => {
              if (editorRef.current && !isDisposedRef.current) {
                try {
                  editorRef.current.focus();
                } catch (error) {
                  // 忽略聚焦错误
                }
              }
            }, 50);
          }
        } catch (error) {
          // 如果设置失败，至少更新统计信息
          updateStats(safeValue);
          isInitialValueSet.current = true;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, updateStats]);

  // 额外的聚焦机制：当组件挂载后，如果启用了自动聚焦，尝试聚焦编辑器
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

  // 🔧 关键修复：监听加载状态变化，确保状态一致性
  useEffect(() => {
    console.log(`[MonacoEditor] 📊 加载状态更新: isLoading = ${isLoading}`, {
      hasEditor: !!editorRef.current,
      isDisposed: isDisposedRef.current,
      timestamp: Date.now(),
    });

    // 🔧 生产环境特殊处理：如果状态更新后仍显示加载中，强制刷新
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && isLoading && editorRef.current) {
      console.log("[MonacoEditor] 🚨 生产环境检测到状态不一致，执行强制刷新");
      // 🚀 延迟状态一致性修复，让其他异步操作先完成
      console.log("[MonacoEditor] ⏱️ 延迟设置状态一致性修复定时器 (500ms)");
      setTimeout(() => {
        console.log("[MonacoEditor] 🎯 状态一致性修复定时器触发", {
          hasEditor: !!editorRef.current,
          isLoading,
          isDisposed: isDisposedRef.current,
          timestamp: Date.now(),
        });
        if (editorRef.current) {
          console.log("[MonacoEditor] 🔄 执行状态一致性修复");
          flushSync(() => setIsLoading(false));
          // 触发其他状态更新以强制重新渲染
          setStats((prev) => ({ ...prev, _forceUpdate: Date.now() }));
          console.log("[MonacoEditor] ✅ 状态一致性修复完成");

          // 🚀 在状态一致性修复完成后，触发最终的功能检查
          setTimeout(() => {
            console.log("[MonacoEditor] 🔍 状态一致性修复后执行最终功能检查");
            if (editorRef.current && !isDisposedRef.current) {
              // 触发 onMount 回调重新执行（如果有的话）
              if (onMount) {
                try {
                  console.log("[MonacoEditor] 🔄 重新触发 onMount 回调");
                  onMount(editorRef.current);
                } catch (error) {
                  console.warn(
                    "[MonacoEditor] ⚠️ 重新触发 onMount 失败:",
                    error,
                  );
                }
              }

              // 确保聚焦功能正常工作
              if (autoFocus) {
                try {
                  console.log("[MonacoEditor] 🎯 状态修复后重新聚焦");
                  editorRef.current.focus();
                } catch (error) {
                  console.warn("[MonacoEditor] ⚠️ 状态修复后聚焦失败:", error);
                }
              }
            }
          }, 100);
        } else {
          console.log("[MonacoEditor] ℹ️ 状态一致性修复跳过 - 条件不满足");
        }
      }, 500); // 延迟到500ms，确保其他异步操作都已完成
    } else {
      console.log("[MonacoEditor] ℹ️ 状态一致性检查跳过 - 条件不满足");
    }
  }, [isLoading, onMount, autoFocus]);

  // 🔧 关键修复：确保在组件卸载时强制设置加载状态为 false
  useEffect(() => {
    return () => {
      console.log("[MonacoEditor] 组件卸载，确保加载状态为 false");
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        flushSync(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    };
  }, []);

  // 🔧 最终保护机制：使用 useLayoutEffect 确保状态同步
  useLayoutEffect(() => {
    console.log("[MonacoEditor] 🎬 useLayoutEffect 触发", {
      hasEditor: !!editorRef.current,
      isLoading,
      isDisposed: isDisposedRef.current,
      timestamp: Date.now(),
    });

    // 如果编辑器已经创建但仍然显示加载状态，强制隐藏
    if (editorRef.current && isLoading) {
      console.log(
        "[MonacoEditor] 🔧 检测到编辑器已创建但加载状态仍为 true，强制修复",
      );
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        console.log(
          "[MonacoEditor] 🚀 useLayoutEffect 使用 flushSync 修复状态",
        );
        flushSync(() => setIsLoading(false));
      } else {
        console.log("[MonacoEditor] 🚀 useLayoutEffect 修复状态");
        setIsLoading(false);
      }

      // 🔧 生产环境特殊处理：强制触发重新渲染
      console.log("[MonacoEditor] ⏱️ useLayoutEffect 设置强制修复定时器");
      setTimeout(() => {
        console.log("[MonacoEditor] 🎯 强制修复定时器触发", {
          hasEditor: !!editorRef.current,
          isLoading,
          isDisposed: isDisposedRef.current,
          timestamp: Date.now(),
        });
        if (editorRef.current) {
          console.log("[MonacoEditor] 🚀 useLayoutEffect 执行强制修复");
          if (isProduction) {
            flushSync(() => setIsLoading(false));
          } else {
            setIsLoading(false);
          }
          // 强制触发组件重新渲染
          setStats((prev) => ({ ...prev }));
          console.log("[MonacoEditor] ✅ useLayoutEffect 强制修复完成");
        } else {
          console.log(
            "[MonacoEditor] ℹ️ useLayoutEffect 强制修复跳过 - 条件不满足",
          );
        }
      }, 50);
    } else {
      console.log("[MonacoEditor] ℹ️ useLayoutEffect 跳过修复 - 条件不满足");
    }
  }, [isLoading]);

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
    <div className={`${monacoStyles["monaco-editor"]} ${className}`}>
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
          opacity: isLoading ? 0.3 : 1,
          transition: "opacity 0.3s ease-in-out",
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

export default MonacoEditor;
