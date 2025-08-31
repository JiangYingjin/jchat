import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco, isMonacoLoaded, monacoPreloader } from "./monaco-preloader";

// 🚀 使用预加载的Monaco Editor，提升加载性能
let Monaco: any = null;

/**
 * Monaco 编辑器加载器
 * 负责 Monaco Editor 的动态加载、预加载检测和初始化配置
 */
export const loadMonaco = async (): Promise<typeof import("monaco-editor")> => {
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
            // 🔍 保持查找功能启用
            find: {
              addExtraSpaceOnTop: false,
              autoFindInSelection: "on-activate",
            },
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
    Monaco.editor.defineTheme("plaintext", {
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

export { Monaco };
