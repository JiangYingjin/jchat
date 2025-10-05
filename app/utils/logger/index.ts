/**
 * 简洁的模块化日志系统
 * 支持自动环境变量检测，无需预定义
 */

// 日志级别枚举
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

// 日志配置接口
export interface LoggerConfig {
  enabled: boolean;
  defaultLevel: LogLevel;
  categories: Record<string, LogCategory>;
  showTimestamp: boolean;
  showLevel: boolean;
  showCategory: boolean;
  showSegment: boolean;
  maxDataDepth: number;
  performanceMode: boolean;
}

// 日志类别接口
export interface LogCategory {
  name: string;
  level: LogLevel;
  enabled: boolean;
  color?: string;
}

// 默认配置
const DEFAULT_CONFIG: LoggerConfig = {
  enabled: process.env.NODE_ENV === "development",
  defaultLevel: LogLevel.DEBUG,
  categories: {},
  showTimestamp: true,
  showLevel: true,
  showCategory: true,
  showSegment: true,
  maxDataDepth: 3,
  performanceMode: false,
};

// 级别名称映射
const LEVEL_NAMES = {
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.WARN]: "WARN",
  [LogLevel.INFO]: "INFO",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.TRACE]: "TRACE",
};

// 日志器类
export class Logger {
  private config: LoggerConfig;
  private isEnabled: boolean;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isEnabled = this.checkEnvironmentEnabled();
  }

  /**
   * 检查环境变量是否启用日志
   */
  private checkEnvironmentEnabled(): boolean {
    // 检查通用调试开关
    if (process.env.NEXT_PUBLIC_DEBUG === "false") {
      return false;
    }
    if (process.env.NEXT_PUBLIC_DEBUG === "true") {
      return true;
    }

    // 默认开发环境启用
    return this.config.enabled;
  }

  /**
   * 检查是否应该记录日志
   */
  private shouldLog(category: string, level: LogLevel): boolean {
    if (!this.isEnabled || !this.config.enabled) {
      return false;
    }

    const categoryConfig = this.config.categories[category];
    if (!categoryConfig || !categoryConfig.enabled) {
      return false;
    }

    return level <= categoryConfig.level;
  }

  /**
   * 格式化数据对象
   */
  private formatData(data: any, depth: number = 0): string {
    if (depth >= this.config.maxDataDepth) {
      return "[Max Depth Reached]";
    }

    if (data === null || data === undefined) {
      return String(data);
    }

    if (
      typeof data === "string" ||
      typeof data === "number" ||
      typeof data === "boolean"
    ) {
      return String(data);
    }

    if (data instanceof Error) {
      return `Error: ${data.message}\nStack: ${data.stack}`;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return "[]";
      if (data.length > 10) return `[Array(${data.length})]`;
      return `[${data.map((item) => this.formatData(item, depth + 1)).join(", ")}]`;
    }

    if (typeof data === "object") {
      try {
        const keys = Object.keys(data);
        if (keys.length === 0) return "{}";
        if (keys.length > 10) return `{Object(${keys.length} keys)}`;

        const pairs = keys
          .slice(0, 5)
          .map((key) => `${key}: ${this.formatData(data[key], depth + 1)}`);
        const result = `{${pairs.join(", ")}}`;
        return keys.length > 5
          ? result + `... (+${keys.length - 5} more)`
          : result;
      } catch (error) {
        return `[Circular Reference]`;
      }
    }

    return String(data);
  }

  /**
   * 生成日志前缀
   */
  private generatePrefix(category: string, level: LogLevel): string {
    const parts: string[] = [];

    if (this.config.showTimestamp) {
      parts.push(new Date().toISOString());
    }

    if (this.config.showLevel) {
      parts.push(`[${LEVEL_NAMES[level]}]`);
    }

    if (this.config.showCategory) {
      parts.push(`[${category}]`);
    }

    return parts.join(" ");
  }

  /**
   * 核心日志方法
   */
  private log(
    level: LogLevel,
    category: string,
    message: string,
    data?: any,
  ): void {
    if (!this.shouldLog(category, level)) {
      return;
    }

    const prefix = this.generatePrefix(category, level);
    const messageText = `${prefix} ${message}`;

    // 分段输出：像 console.log("🔥 [CHAT] 会话变化", {...}) 这样
    if (this.config.showSegment && data) {
      // 根据级别选择输出方法，分别传递消息和数据
      switch (level) {
        case LogLevel.ERROR:
          console.error(messageText, data);
          break;
        case LogLevel.WARN:
          console.warn(messageText, data);
          break;
        default:
          console.log(messageText, data);
          break;
      }
    } else {
      // 传统输出方式：合并成单个字符串
      const formattedData = data ? this.formatData(data) : "";
      const fullMessage = `${messageText}${formattedData ? "\n" + formattedData : ""}`;

      switch (level) {
        case LogLevel.ERROR:
          console.error(fullMessage);
          break;
        case LogLevel.WARN:
          console.warn(fullMessage);
          break;
        default:
          console.log(fullMessage);
          break;
      }
    }
  }

  /**
   * 公共日志方法
   */
  error(category: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data);
  }

  warn(category: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  info(category: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  debug(category: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  trace(category: string, message: string, data?: any): void {
    this.log(LogLevel.TRACE, category, message, data);
  }

  /**
   * 性能测量
   */
  time(label: string): void {
    if (this.shouldLog("PERFORMANCE", LogLevel.DEBUG)) {
      console.time(label);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog("PERFORMANCE", LogLevel.DEBUG)) {
      console.timeEnd(label);
    }
  }

  /**
   * 检查是否启用
   */
  isLoggingEnabled(): boolean {
    return this.isEnabled && this.config.enabled;
  }
}

/**
 * 创建模块化日志器
 * @param moduleName 模块名称，会自动检测 NEXT_PUBLIC_DEBUG_{moduleName} 环境变量
 * @param defaultLevel 默认日志级别
 * @param color 日志颜色（可选）
 */
export function createModuleLogger(
  moduleName: string,
  defaultLevel: LogLevel = LogLevel.DEBUG,
  color?: string,
): Logger {
  // 自动检测环境变量
  const isEnabled = checkModuleEnabled(moduleName);

  const config: LoggerConfig = {
    enabled: isEnabled,
    defaultLevel,
    categories: {
      [moduleName]: {
        name: moduleName,
        level: defaultLevel,
        enabled: isEnabled,
        color,
      },
    },
    showTimestamp: true,
    showLevel: true,
    showCategory: true,
    showSegment: true,
    maxDataDepth: 3,
    performanceMode: false,
  };

  return new Logger(config);
}

/**
 * 检查模块是否启用
 */
function checkModuleEnabled(moduleName: string): boolean {
  // 检查全局调试开关
  if (process.env.NEXT_PUBLIC_DEBUG === "false") {
    return false;
  }
  if (process.env.NEXT_PUBLIC_DEBUG === "true") {
    return true;
  }

  // 检查模块特定的环境变量
  /* 
    Next.js 的 NEXT_PUBLIC_ 变量在构建时被直接替换，而不是存储在 process.env 中
    不能通过以下这种方式获取环境变量，因为 NEXT_PUBLIC_ 变量在构建时被直接替换，而不是存储在 process.env 中
      const envVarName = "NEXT_PUBLIC_DEBUG_CHAT";
      process.env[envVarName]  // → undefined
  */
  let moduleEnvValue: string | undefined;

  // 根据变量名获取对应的环境变量值
  switch (moduleName.toUpperCase()) {
    case "CHAT":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_CHAT;
      break;
    case "SCROLL":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_SCROLL;
      break;
    case "MESSAGE_LIST":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_MESSAGE_LIST;
      break;
    case "CHAT_HEADER":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_CHAT_HEADER;
      break;
    case "SYNC":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_SYNC;
      break;
    case "MARKDOWN":
      moduleEnvValue = process.env.NEXT_PUBLIC_DEBUG_MARKDOWN;
      break;
    default:
      // 优化：只在开发环境下输出警告，避免生产环境噪音
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[Logger] 未找到模块 "${moduleName}" 的调试环境变量，使用默认值。`,
        );
      }
  }

  if (moduleEnvValue === "false") {
    return false;
  }
  if (moduleEnvValue === "true") {
    return true;
  }

  // 默认开发环境启用
  return process.env.NODE_ENV === "development";
}

// 便捷的日志器创建函数
export const createLogger = createModuleLogger;

// 创建默认实例
export const logger = new Logger();
