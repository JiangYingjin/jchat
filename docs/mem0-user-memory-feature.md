# 用户记忆 (mem0_user_id) 功能方案

## 1. 需求摘要

- 在**设置页**增加可配置项 `mem0_user_id`（用户记忆）。
- **不填**：默认不启用用户记忆。
- **填写且 strip 后非空**：在聊天输入区（chat-input-actions）增加一个**开关按钮**，默认关闭；用户打开后，**当前会话**在请求中带上 `mem0_user_id`，后端按该 ID 接入 Mem0 用户记忆。

## 2. 后端现状（无需改）

- **`/www/django/app/chat_completions/memory.py`**：提供 `get_context(user_id, query)`、`add_memory(messages, user_id)`、`build_messages_with_memory(messages, user_id, query)`。
- **`/www/django/app/chat_completions/core.py`**：
  - `_parse_request` 从请求体取 `mem0_user_id`：`_mid = self.data.get("mem0_user_id")`，得到 `self.mem0_user_id`（有则接入记忆，无则不接入）。
  - 有 `mem0_user_id` 时：流式前用 `build_messages_with_memory` 注入记忆，流结束后用 `add_memory` 写入本轮对话。

结论：前端只需在请求体里按需附带 `mem0_user_id` 字段即可，后端已支持。

---

## 3. 前端改动规划

### 3.1 数据与状态

| 位置 | 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|------|
| **全局 store**（`app/store/chat.ts`） | `mem0_user_id` | `string` | `""` | 设置页配置的 Mem0 用户 ID，持久化。 |
| **会话**（`ChatSession`） | `useMemory` | `boolean`（可选） | `false` | 当前会话是否启用用户记忆，持久化。 |

- 仅当 `mem0_user_id.trim() !== ""` 且**当前为普通会话（非组会话）**时，才在 chat-input-actions 中显示「用户记忆」按钮；按钮控制的是**当前会话**的 `useMemory`。
- 发送请求时：仅当**当前为普通会话**且当前会话 `useMemory === true` 且全局 `mem0_user_id.trim() !== ""` 时，在请求体中附带 `mem0_user_id: mem0_user_id.trim()`。
- **组会话**：无论任何情况下都不使用用户记忆——不显示「用户记忆」按钮，也不在请求中附带 `mem0_user_id`。

### 3.2 需要修改的文件与内容

#### 3.2.1 全局状态与持久化

- **`app/store/chat.ts`**
  - 在 `DEFAULT_CHAT_STATE` 中增加：`mem0_user_id: ""`。
  - 增加方法：`setMem0UserId(value: string): void`，用于设置页写入。
  - `partialize` 已持久化整个 state（除明确排除的），因此 `mem0_user_id` 会自动持久化，无需改 partialize 逻辑（除非希望排除该字段，此处建议持久化）。

#### 3.2.2 会话类型与默认值

- **`app/store/chat.ts`**  
  - `ChatSession` 接口增加：`useMemory?: boolean`。
- **`app/utils/session.ts`**  
  - `createEmptySession()` 返回值中增加：`useMemory: false`。
  - 若存在 `createBranchSession` 等复制会话的逻辑，需决定是否继承 `useMemory`（建议继承：`useMemory: originalSession.useMemory ?? false`）。

#### 3.2.3 设置页

- **`app/components/settings.tsx`**
  - 在「本地数据」等现有区块旁或下方新增一个设置区块（如「用户记忆」）。
  - 使用 `ListItem` + 输入框（或 `Input`）：  
    - 标题/说明：如「Mem0 用户 ID（用户记忆）」；占位符可说明不填则不启用。
  - 从 `useChatStore` 读 `mem0_user_id`，写入时调用 `setMem0UserId(value)`；可对输入做 `trim()` 再存，或存原始值、在用时再 `trim()`（建议存 trim 后值或使用时 trim，保持一致即可）。

#### 3.2.4 聊天输入区按钮

- **`app/components/chat-actions.tsx`**
  - 从 store 取：`mem0_user_id`、当前会话 `session`（含 `useMemory`、`groupId`）。
  - 条件渲染：仅当 **非组会话**（`!session.groupId`）且 `mem0_user_id?.trim()` 非空时，渲染「用户记忆」按钮；**组会话下不显示该按钮**。
  - 按钮行为：点击切换当前会话的 `useMemory`（`updateSession`，同 `longInputMode`）。
  - 样式：参考「长输入模式」/「忽略系统提示词」的按下态（高亮、边框等），便于区分开/关。

#### 3.2.5 请求体携带 mem0_user_id

- **`app/client/api.ts`**  
  - `ChatOptions` 增加可选字段：`mem0_user_id?: string`。
- **`app/client/openai.ts`**  
  - `RequestPayload` 增加可选字段：`mem0_user_id?: string`。  
  - 在组装 `requestPayload` 时：若 `options.mem0_user_id` 存在且 `trim()` 非空，则 `requestPayload.mem0_user_id = options.mem0_user_id.trim()`。
- **`app/store/chat.ts`**  
  - 在调用 `api.llm.chat(...)` 的地方（当前为单处：发送消息的主流程），在构造 `chat()` 的 options 时：  
    - 仅当**当前为普通会话**（`!session.groupId`）且 `session.useMemory === true` 且 `getState().mem0_user_id?.trim()` 非空时，传入 `mem0_user_id: getState().mem0_user_id.trim()`；**组会话不传**，其他情况也不传。

注意：若项目中有多处调用 `api.llm.chat`（例如 `utils/session.ts` 里生成标题），**仅**在用户主动发送聊天消息的那处传入 `mem0_user_id`；标题生成等辅助请求不要带 `mem0_user_id`。

#### 3.2.6 组会话（不使用用户记忆）

- **组会话完全不使用用户记忆**：不显示「用户记忆」按钮，发送请求时也绝不附带 `mem0_user_id`。
- 组内会话的 `ChatSession` 仍可保留 `useMemory` 字段（与普通会话结构一致），但前端逻辑上对组会话忽略该字段即可。

#### 3.2.7 多标签页同步（可选）

- 若希望多标签页下「设置页修改 mem0_user_id」或「会话 useMemory」与其他标签页同步，且项目已有跨标签页同步（如 broadcastChannel / storage 事件），只需保证 `mem0_user_id` 与 `session.useMemory` 都落在被同步的 store 中即可；无需额外逻辑除非有特殊需求。

#### 3.2.8 文案与无障碍

- **`app/locales.ts`**（或对应语言文件）：  
  - 为设置页「用户记忆」、输入框占位/说明、以及 chat-actions 的「用户记忆」按钮增加文案 key，便于中英文与无障碍（如 `aria-label`）。

---

## 4. 数据流小结

1. **设置页**：用户输入 Mem0 User ID → `setMem0UserId(value)` → 写入 `chatStore.mem0_user_id` 并持久化。
2. **聊天页**：仅**普通会话**且 `mem0_user_id.trim()` 非空时显示「用户记忆」按钮；点击 → 切换当前会话的 `useMemory`（并持久化）。组会话不显示按钮。
3. **发送消息**：仅**普通会话**且当前会话 `useMemory === true` 且 `mem0_user_id.trim()` 非空时，在 `api.llm.chat` 的 options 中传入 `mem0_user_id` → `openai.ts` 将其放入 `requestPayload` → 请求体带 `mem0_user_id` → 后端接入该用户记忆。组会话不附带 `mem0_user_id`。

---

## 5. 实现检查清单（实现时可按此自检）

- [ ] store：`mem0_user_id` 初始值与 `setMem0UserId`。
- [ ] `ChatSession` 与 `createEmptySession`（及分支会话）的 `useMemory`。
- [ ] 设置页：输入框绑定 `mem0_user_id` 与 `setMem0UserId`。
- [ ] chat-actions：仅普通会话且 `mem0_user_id` 非空时渲染「用户记忆」按钮，点击切换 `session.useMemory`；组会话不显示。
- [ ] `ChatOptions` / `RequestPayload` 增加 `mem0_user_id`；仅在发送用户消息的那处传入。
- [ ] 仅当「普通会话且会话 useMemory 且全局 mem0_user_id 非空」时附带 `mem0_user_id`；组会话不附带。
- [ ] 文案与无障碍（含 locales）。

本方案仅做设计与规划，具体实现见后续开发。
