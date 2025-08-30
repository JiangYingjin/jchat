import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

/**
 * Monaco Editor 性能优化配置
 * 专门为大文本系统提示词优化，已禁用所有语言服务功能
 */
export const PERFORMANCE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions =
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
