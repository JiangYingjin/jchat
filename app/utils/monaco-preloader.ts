/**
 * Monaco Editor 预加载器
 * 在应用启动时预加载Monaco Editor，提升编辑器加载性能
 */

interface MonacoPreloadState {
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  Monaco: any;
  loader: Promise<any> | null;
}

class MonacoPreloader {
  private static instance: MonacoPreloader;
  private state: MonacoPreloadState = {
    isLoading: false,
    isLoaded: false,
    error: null,
    Monaco: null,
    loader: null,
  };

  private constructor() {}

  static getInstance(): MonacoPreloader {
    if (!MonacoPreloader.instance) {
      MonacoPreloader.instance = new MonacoPreloader();
    }
    return MonacoPreloader.instance;
  }

  /**
   * 预加载Monaco Editor
   */
  async preload(): Promise<any> {
    // 如果已经加载完成，直接返回
    if (this.state.isLoaded && this.state.Monaco) {
      return this.state.Monaco;
    }

    // 如果正在加载中，返回现有的loader
    if (this.state.isLoading && this.state.loader) {
      return this.state.loader;
    }

    // 开始加载
    this.state.isLoading = true;
    this.state.error = null;

    this.state.loader = this.loadMonaco();

    try {
      this.state.Monaco = await this.state.loader;
      this.state.isLoaded = true;
      this.state.isLoading = false;
      console.log("✅ Monaco Editor 预加载完成");
      return this.state.Monaco;
    } catch (error) {
      this.state.error =
        error instanceof Error ? error.message : "Monaco加载失败";
      this.state.isLoading = false;
      this.state.loader = null;
      console.error("❌ Monaco Editor 预加载失败:", error);
      throw error;
    }
  }

  /**
   * 加载Monaco Editor的核心逻辑
   */
  private async loadMonaco(): Promise<any> {
    if (typeof window === "undefined") {
      throw new Error("Monaco Editor 只能在浏览器环境中加载");
    }

    try {
      // 动态导入Monaco Editor
      const monaco = await import("monaco-editor");

      // 配置Monaco主题
      monaco.editor.defineTheme("system-prompt-theme", {
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

      // 配置Monaco环境
      if (typeof (window as any).MonacoEnvironment === "undefined") {
        (window as any).MonacoEnvironment = {
          getWorkerUrl: function (moduleId: any, label: string) {
            if (label === "json") {
              return "/monaco-editor/esm/vs/language/json/json.worker?worker";
            }
            if (label === "css" || label === "scss" || label === "less") {
              return "/monaco-editor/esm/vs/language/css/css.worker?worker";
            }
            if (
              label === "html" ||
              label === "handlebars" ||
              label === "razor"
            ) {
              return "/monaco-editor/esm/vs/language/html/html.worker?worker";
            }
            if (label === "typescript" || label === "javascript") {
              return "/monaco-editor/esm/vs/language/typescript/ts.worker?worker";
            }
            return "/monaco-editor/esm/vs/editor/editor.worker?worker";
          },
        };
      }

      return monaco;
    } catch (error) {
      console.error("Monaco Editor 加载失败:", error);
      throw error;
    }
  }

  /**
   * 获取Monaco实例（如果已加载）
   */
  getMonaco(): any {
    return this.state.Monaco;
  }

  /**
   * 检查Monaco是否已加载
   */
  isMonacoLoaded(): boolean {
    return this.state.isLoaded;
  }

  /**
   * 检查Monaco是否正在加载
   */
  isMonacoLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * 获取加载状态
   */
  getState() {
    return {
      isLoading: this.state.isLoading,
      isLoaded: this.state.isLoaded,
      error: this.state.error,
    };
  }

  /**
   * 重置加载状态（主要用于测试或错误恢复）
   */
  reset() {
    this.state = {
      isLoading: false,
      isLoaded: false,
      error: null,
      Monaco: null,
      loader: null,
    };
  }
}

// 导出单例实例
export const monacoPreloader = MonacoPreloader.getInstance();

// 便捷方法
export const preloadMonaco = () => monacoPreloader.preload();
export const getMonaco = () => monacoPreloader.getMonaco();
export const isMonacoLoaded = () => monacoPreloader.isMonacoLoaded();
export const isMonacoLoading = () => monacoPreloader.isMonacoLoading();
