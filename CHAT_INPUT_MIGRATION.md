# 聊天输入数据迁移到 IndexedDB

## 概述

本次更新将聊天输入数据的存储从 localStorage 迁移到 IndexedDB，提供更大的存储空间和更好的性能。

## 实现的功能

### 1. 新增 ChatInputStorage 类

在 `app/store/chat.ts` 中新增了 `ChatInputStorage` 类，用于处理聊天输入数据的 IndexedDB 存储：

- **数据库**: JChat
- **表名**: chatInput
- **版本**: 2 (升级以添加新的存储表)
- **键**: 会话ID
- **值**: `{"text": "输入文本", "images": ["图片URL"], "scrollTop": 滚动位置, "updateAt": 更新时间}`

### 2. 核心方法

- `saveChatInput(sessionId, data)`: 保存聊天输入数据到 IndexedDB
- `getChatInput(sessionId)`: 从 IndexedDB 读取聊天输入数据
- `deleteChatInput(sessionId)`: 删除指定会话的聊天输入数据
- `getAllSessionIds()`: 获取所有存储的会话ID
- `cleanupExpiredData()`: 清理过期的聊天输入数据

### 3. 数据迁移策略

#### 启动时一次性迁移

- 检查是否已经迁移过（通过 localStorage 标记）
- 扫描 localStorage 中的旧数据（`chat-input-text-*`, `chat-input-images-*`, `chat-input-scroll-top-*`）
- 按会话ID分组数据
- 批量迁移到 IndexedDB
- 清理 localStorage 中的旧数据
- 设置迁移完成标记

#### 会话删除时清理

- 在 `deleteSession` 方法中添加删除对应 chatInput 数据的逻辑
- 在 `clearAllData` 方法中添加清理所有 chatInput 数据的逻辑

### 4. 修改的组件

#### chat.tsx 主要修改

1. **存储函数改造**:

   - `saveChatInputText`: 改为异步，使用 IndexedDB
   - `saveChatInputImages`: 改为异步，使用 IndexedDB
   - `saveChatInputScrollTop`: 改为异步，使用 IndexedDB
   - `loadChatInputData`: 新增异步加载函数

2. **数据加载**:

   - 修改 `useEffect` 为异步加载
   - 统一加载文本、图片和滚动位置

3. **数据清理**:

   - 修改 `doSubmit` 函数，提交后清理 IndexedDB 数据
   - 修改图片删除逻辑，实时保存到 IndexedDB

4. **迁移逻辑**:
   - 添加启动时数据迁移的 `useEffect`
   - 自动迁移 localStorage 数据到 IndexedDB

### 5. 数据格式

#### 旧格式 (localStorage)

```
chat-input-text-{sessionId}: "用户输入的文本"
chat-input-images-{sessionId}: ["图片URL1", "图片URL2"]
chat-input-scroll-top-{sessionId}: "滚动位置"
```

#### 新格式 (IndexedDB)

```json
{
  "sessionId": "会话ID",
  "text": "用户输入的文本",
  "images": ["图片URL1", "图片URL2"],
  "scrollTop": 滚动位置,
  "updateAt": 更新时间戳
}
```

## 优势

1. **更大的存储空间**: IndexedDB 通常有几百MB到几GB的存储空间
2. **更好的性能**: 异步操作，不阻塞主线程
3. **结构化数据**: 统一的数据格式，便于管理
4. **自动迁移**: 启动时自动迁移旧数据
5. **自动清理**: 删除会话时自动清理相关数据

## 兼容性

- 自动迁移 localStorage 中的旧数据
- 保持原有的功能不变
- 向后兼容，不会丢失用户数据

## 使用方式

用户无需任何操作，系统会自动：

1. 在首次启动时迁移现有数据
2. 实时保存用户的输入状态
3. 在会话切换时恢复输入状态
4. 在删除会话时清理相关数据

## 技术细节

### IndexedDB 版本升级

- 从版本 1 升级到版本 2
- 新增 `chatInput` 存储表
- 保持 `systemMessages` 表兼容性

### 错误处理

- 所有 IndexedDB 操作都有 try-catch 错误处理
- 控制台输出详细的错误信息
- 不会因为存储错误影响主要功能

### 性能优化

- 使用防抖保存文本输入（500ms）
- 异步操作不阻塞 UI
- 批量迁移减少数据库操作次数
