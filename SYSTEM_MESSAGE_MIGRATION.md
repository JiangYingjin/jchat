# 系统消息数据迁移到 IndexedDB

## 概述

本次更新将系统消息数据的存储从 localStorage 迁移到 IndexedDB，并添加了滚动位置和光标位置的保存功能。

## 实现的功能

### 1. 新的数据格式

#### SystemMessageData 接口

```typescript
interface SystemMessageData {
  text: string; // 系统消息文本内容
  images: string[]; // 系统消息图片
  scrollTop: number; // 滚动位置
  selection: {
    // 光标位置
    start: number;
    end: number;
  };
  updateAt: number; // 更新时间
}
```

#### ChatInputData 接口（更新）

```typescript
interface ChatInputData {
  text: string; // 聊天输入文本
  images: string[]; // 聊天输入图片
  scrollTop: number; // 滚动位置
  selection: {
    // 光标位置（新增）
    start: number;
    end: number;
  };
  updateAt: number; // 更新时间
}
```

### 2. 数据库升级

- **数据库**: JChat
- **版本**: 3 (升级以支持新的数据格式)
- **表名**:
  - `systemMessages` - 系统消息数据
  - `chatInput` - 聊天输入数据

### 3. 核心功能

#### 系统消息存储

- `saveSystemMessage(sessionId, data)`: 保存系统消息数据到 IndexedDB
- `getSystemMessage(sessionId)`: 从 IndexedDB 读取系统消息数据
- `deleteSystemMessage(sessionId)`: 删除指定会话的系统消息数据
- `getSystemMessageLegacy(sessionId)`: 兼容旧格式的读取方法
- `getAllSessionIds()`: 获取所有系统消息会话ID
- `migrateOldFormatData()`: 迁移 IndexedDB 中的旧格式数据到新格式

#### 聊天输入存储（更新）

- 新增 `selection` 字段支持
- 实时保存光标位置
- 自动恢复光标位置和滚动位置

### 4. 数据迁移策略

#### 启动时一次性迁移

- 检查是否已经迁移过（通过 localStorage 标记）
- 扫描 localStorage 中的旧数据：
  - `chat-input-text-*` - 聊天输入文本
  - `chat-input-images-*` - 聊天输入图片
  - `chat-input-scroll-top-*` - 聊天输入滚动位置
- 按会话ID分组数据
- 批量迁移聊天输入数据到 IndexedDB
- 清理 localStorage 中的旧数据
- **迁移 IndexedDB 中现有的旧格式系统消息数据**：
  - 扫描所有现有的系统消息记录
  - 解析旧格式的 JSON 数据（`{content: "文本", images: ["图片URL"]}`）
  - 转换为新格式并重新保存
- 设置迁移完成标记

**注意：** 系统消息数据已经在 IndexedDB 中，只需要迁移旧格式数据，不需要从 localStorage 迁移

#### 会话删除时清理

- 在 `deleteSession` 方法中同时删除对应的 chatInput 和 systemMessages 数据
- 在 `clearAllData` 方法中清理所有数据

### 5. 用户体验改进

#### 光标位置记忆

- 实时保存用户的光标位置
- 切换会话时自动恢复光标位置
- 支持文本选择状态的保存

#### 滚动位置记忆

- 保存文本区域的滚动位置
- 切换会话时自动恢复滚动位置
- 系统消息编辑时也支持滚动位置记忆

#### 系统消息编辑增强

- 打开编辑模态框时自动定位到上次编辑的位置
- 保存时记录当前的滚动位置和光标位置
- 支持图片和文本的混合内容

### 6. 兼容性处理

#### 旧格式兼容

- 提供 `getSystemMessageLegacy` 方法处理旧格式数据
- 自动检测数据格式并进行转换
- 平滑迁移，不影响现有功能

#### IndexedDB 旧格式数据迁移

- 新增 `migrateOldFormatData` 方法专门处理 IndexedDB 中的旧格式数据
- 支持解析旧格式的 JSON 数据：`{content: "文本", images: ["图片URL"]}`
- 自动提取 `content` 和 `images` 字段
- 转换为新格式：`{text: "文本", images: ["图片URL"], scrollTop: 0, selection: {start: 0, end: 0}, updateAt: 时间戳}`
- 逐个更新每个会话的记录

#### 错误处理

- 迁移失败时不影响正常使用
- 数据读取失败时提供默认值
- 详细的错误日志记录

### 7. 性能优化

#### 异步操作

- 所有存储操作都是异步的
- 使用防抖保存减少频繁写入
- 批量迁移提高效率

#### 内存管理

- 及时清理过期的 localStorage 数据
- 自动清理无效的 IndexedDB 记录
- 优化数据结构和存储格式

## 使用说明

### 开发者

1. 系统消息数据现在使用新的 `SystemMessageData` 格式
2. 聊天输入数据新增 `selection` 字段
3. 所有存储操作都是异步的，需要使用 `await`
4. 迁移是自动的，无需手动干预

### 用户

1. 应用启动时会自动迁移现有数据
2. 光标位置和滚动位置会自动保存和恢复
3. 系统消息编辑时会记住上次的位置
4. 删除会话时会清理所有相关数据

## 技术细节

### 数据库版本管理

- 使用 IndexedDB 版本控制确保表结构正确
- 自动创建缺失的表
- 支持数据格式升级

### 事件处理

- 监听 `onInput` 事件保存光标位置
- 监听 `onBlur` 事件保存最终状态
- 监听 `onScroll` 事件保存滚动位置

### 状态管理

- 使用 React 状态管理滚动位置和光标位置
- 防抖处理避免频繁更新
- 异步加载确保数据完整性
