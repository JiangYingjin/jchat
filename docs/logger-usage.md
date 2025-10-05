# 简洁的模块化日志系统

## 快速开始

```typescript
import { createModuleLogger, LogLevel } from "../utils/logger";

// 创建模块日志器 - 自动检测环境变量
const chatLogger = createModuleLogger("CHAT");
const scrollLogger = createModuleLogger("SCROLL");

// 使用日志器 - 支持分段输出
chatLogger.debug("CHAT", "消息处理", { messageId: "msg-123" });
scrollLogger.debug("SCROLL", "滚动更新", { position: 100 });

// 支持在消息中直接使用表情符号
chatLogger.debug("CHAT", "🔥 会话变化", { sessionId: "session-123" });
```

## 环境变量控制

```bash
# 全局控制
NEXT_PUBLIC_DEBUG=true/false

# 模块控制（自动检测）
NEXT_PUBLIC_DEBUG_CHAT=true/false
NEXT_PUBLIC_DEBUG_SCROLL=true/false
```

## 日志级别

- `LogLevel.ERROR` (0) - 错误信息
- `LogLevel.WARN` (1) - 警告信息
- `LogLevel.INFO` (2) - 一般信息
- `LogLevel.DEBUG` (3) - 调试信息
- `LogLevel.TRACE` (4) - 跟踪信息

## 使用示例

```typescript
// 创建不同级别的日志器
const authLogger = createModuleLogger("AUTH", LogLevel.INFO);
const uiLogger = createModuleLogger("UI", LogLevel.DEBUG);

// 不同级别的日志
authLogger.error("AUTH", "登录失败", { error: "密码错误" });
authLogger.warn("AUTH", "重试登录", { attempt: 2 });
authLogger.info("AUTH", "登录成功", { userId: "123" });
uiLogger.debug("UI", "组件渲染", { component: "Button" });

// 在消息中直接使用表情符号
chatLogger.debug("CHAT", "🔥 会话变化", { sessionId: "session-123" });
chatLogger.info("CHAT", "🚀 启动完成", { version: "1.0.0" });
chatLogger.info("CHAT", "✅ 操作成功", { result: "success" });
```

## 分段输出特性

日志系统支持分段输出，就像 `console.log("🔥 [CHAT] 会话变化", {...})` 这样：

```typescript
// 输出效果：
// [DEBUG] [CHAT] 🔥 会话变化 { sessionId: "session-123", ... }
chatLogger.debug("CHAT", "🔥 会话变化", {
  sessionId: "session-123",
  sessionTitle: "测试会话",
  messageCount: 5,
});
```

## 性能优化

```typescript
// 在性能敏感的地方，先检查是否启用
if (logger.isLoggingEnabled()) {
  const expensiveData = processExpensiveData();
  logger.debug("MODULE", "调试信息", expensiveData);
}
```

就这么简单！🎯
