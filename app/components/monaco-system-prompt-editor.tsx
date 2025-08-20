import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import { editor } from "monaco-editor";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";

// 动态导入Monaco Editor，避免SSR问题
let Monaco: any = null;
const loadMonaco = async () => {
  if (!Monaco && typeof window !== "undefined") {
    // 动态导入monaco-editor
    Monaco = await import("monaco-editor");

    // 配置Monaco Editor
    Monaco.editor.defineTheme("system-prompt-theme", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "variable", foreground: "0066cc", fontStyle: "bold" },
        { token: "instruction", foreground: "008000" },
        { token: "emphasis", foreground: "ff6600", fontStyle: "italic" },
      ],
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
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

// 性能优化配置 - 专门为大文本系统提示词优化
const PERFORMANCE_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  // 🚀 核心性能优化
  automaticLayout: true,
  wordWrap: "on",
  scrollBeyondLastLine: false,
  smoothScrolling: false,

  // 🎯 渲染优化
  renderLineHighlight: "none",
  renderWhitespace: "none",
  renderControlCharacters: false,
  renderFinalNewline: "off",

  // 💾 内存优化
  maxTokenizationLineLength: 20000,
  stopRenderingLineAfter: 10000,

  // ⚡ 输入优化
  acceptSuggestionOnEnter: "off",
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  hover: { enabled: false },

  // 🎨 界面优化
  minimap: { enabled: false },
  scrollbar: {
    vertical: "auto",
    horizontal: "auto",
    verticalScrollbarSize: 12,
    horizontalScrollbarSize: 12,
  },

  // 📝 编辑器行为
  fontSize: 14,
  lineHeight: 22,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,

  // 🛡️ 功能禁用（减少开销）
  codeLens: false,
  contextmenu: true,
  copyWithSyntaxHighlighting: false,
  emptySelectionClipboard: false,
  links: false,
  mouseWheelZoom: false,
  selectionClipboard: false,

  // 📐 布局
  padding: { top: 16, bottom: 16 },
  lineNumbers: "off",
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
};

// 自定义语言支持（为系统提示词定制）
const SYSTEM_PROMPT_LANGUAGE = "system-prompt";

const registerSystemPromptLanguage = (monaco: any) => {
  // 注册自定义语言
  monaco.languages.register({ id: SYSTEM_PROMPT_LANGUAGE });

  // 定义语法高亮规则
  monaco.languages.setMonarchTokensProvider(SYSTEM_PROMPT_LANGUAGE, {
    tokenizer: {
      root: [
        // 变量语法：{variable_name}
        [/\{[^}]+\}/, "variable"],

        // 指令标记：# 开头的行
        [/^#.*$/, "instruction"],

        // 强调文本：**text** 或 *text*
        [/\*\*[^*]+\*\*/, "emphasis"],
        [/\*[^*]+\*/, "emphasis"],

        // 引用：> 开头的行
        [/^>.*$/, "comment"],
      ],
    },
  });

  // 配置语言特性
  monaco.languages.setLanguageConfiguration(SYSTEM_PROMPT_LANGUAGE, {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
};

export const MonacoSystemPromptEditor: React.FC<
  MonacoSystemPromptEditorProps
> = ({
  value,
  onChange,
  onMount,
  className,
  placeholder = "请输入系统提示词...",
  readOnly = false,
  autoFocus = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const disposableRef = useRef<any>(null);
  const isDisposedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ characters: 0, lines: 0, words: 0 });

  // 🚀 性能监控
  const updateStats = useCallback((text: string) => {
    const characters = text.length;
    const lines = text.split("\n").length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setStats({ characters, lines, words });
  }, []);

  // 初始化Monaco Editor
  useEffect(() => {
    let isMounted = true;

    const initMonaco = async () => {
      try {
        const monaco = await loadMonaco();

        if (!isMounted || !containerRef.current) return;

        // 注册自定义语言
        registerSystemPromptLanguage(monaco);

        // 创建编辑器实例
        const editorInstance = monaco.editor.create(containerRef.current, {
          ...PERFORMANCE_OPTIONS,
          value,
          language: SYSTEM_PROMPT_LANGUAGE,
          theme: "system-prompt-theme",
          readOnly,
          placeholder,
        });

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

          const currentValue = editorInstance.getValue();
          onChange(currentValue);
          updateStats(currentValue);
        });

        // 保存disposable以便清理
        disposableRef.current = disposable;

        // 初始统计
        updateStats(value);

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
            disposableRef.current.dispose();
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
  }, [onChange, onMount, readOnly, placeholder, autoFocus, updateStats]);

  // 处理外部value变化（避免光标跳转）
  const isInitialValueSet = useRef(false);
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      // 只在初始化时或值确实不同时才设置值
      if (
        !isInitialValueSet.current ||
        (currentValue !== value && value !== currentValue)
      ) {
        // 保存当前光标位置
        const selection = editorRef.current.getSelection();
        const scrollTop = editorRef.current.getScrollTop();

        // 设置新值
        editorRef.current.setValue(value);

        // 恢复光标位置和滚动位置
        if (selection && isInitialValueSet.current) {
          editorRef.current.setSelection(selection);
          editorRef.current.setScrollTop(scrollTop);
        }

        updateStats(value);
        isInitialValueSet.current = true;
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
