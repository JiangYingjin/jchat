# 提案：收藏会话功能（Favorite Sessions）

> 目标：为**普通会话**提供收藏能力，并在侧边栏通过「已收藏会话」视图快速筛选与访问。**本文为提案，暂不实现。**

---

## 1. 背景与目标

- 用户希望把常用或重要的普通会话标记为「已收藏」，并能在侧边栏快速切换到「仅看已收藏」列表，避免在大量会话中翻找。
- **范围**：仅针对**普通会话**（`groupId === null`）；组会话不参与收藏、不展示收藏相关入口。

---

## 2. 如何收藏 / 取消收藏

### 2.1 会话编辑（SessionEditor）中增加一行

- 在现有「会话标题」「统计数据」之间（或标题下方）增加**一行**：「收藏会话」/「取消收藏」。
- **仅当当前编辑的是普通会话时显示**；组内会话编辑时不显示该行。
- 交互：**点击即立即更新**当前会话的收藏状态并持久化，同时 toast 提示；不依赖「保存后关闭」。

### 2.2 共用右键菜单（SessionContextMenu）中增加一项

- 在现有「移至顶部」「更新标题」「生成标题」基础上，增加**一项**：
  - 若该会话**未收藏**：显示「收藏会话」，点击后设为已收藏。
  - 若该会话**已收藏**：显示「取消收藏」，点击后取消收藏。
- **仅对普通会话显示该项**；组内会话的右键菜单不显示收藏相关项。
- 行为与 SessionEditor 中的收藏状态一致（同一 `session.isFavorite` 字段）。

---

## 3. 主列表与「已收藏」视图

### 3.1 主列表（全部普通会话）

- 侧边栏的**普通会话列表**暂时**不因收藏而改变顺序或样式**（与当前行为一致）。
- 后续若需要「已收藏」在列表中有轻微视觉区分（如小图标），可单独迭代，本提案不强制。

### 3.2 「已收藏会话」视图（子集 + Toggle）

- 在侧边栏**底部**，在现有三个按钮（设置、组会话、新建）的基础上，增加第四个按钮：**「已收藏会话」**（或星标图标 + title）。
- **点击该按钮**：在「全部普通会话」与「已收藏会话」两个列表视图之间 **Toggle**，与当前「普通会话 ⇄ 组会话」的切换方式一致。
- 当处于「已收藏会话」视图时：
  - 列表内容 = 对 `sessions` 按 `session.isFavorite === true` 做 **filter** 得到的子集。
  - 列表的**滚动位置**与「全部普通会话」**独立保存、独立恢复**（与现有 `sessions` / `groups` 的 `sidebarScrollHistory` 机制一致）。
- 分页加载（加载更多）在「已收藏会话」视图中**同样需要**：只对当前过滤后的列表做分页；若现有分页逻辑是直接基于 `sessions` 与 `sessionPagination`，则需要**抽象出「数据源 + 分页」的复用**，使「全部」与「已收藏」共用同一套分页与滚动加载逻辑，仅数据源不同（全部 `sessions` vs. `sessions.filter(s => s.isFavorite)`）。

---

## 4. 数据与状态

### 4.1 ChatSession 增加字段

- 在 `ChatSession` 上增加可选字段，例如：`isFavorite?: boolean`（默认 `false` 或未定义视为未收藏）。
- 该字段需要随现有持久化一起写入（IndexedDB / 现有 store 持久化），保证刷新与多标签同步后仍生效。

### 4.2 侧边栏列表的「视图模式」

- 当前已有：`chatListView: "sessions" | "groups"`，用于区分普通会话列表与组列表。
- 建议扩展为在「普通会话」下再区分**全部**与**已收藏**，例如：
  - 方式 A：`chatListView: "sessions" | "sessions-favorited" | "groups"`，其中 `sessions-favorited` 表示当前显示的是已收藏子集。
  - 方式 B：保持 `chatListView: "sessions" | "groups"`，另增 `chatListSessionsFilter: "all" | "favorited"`，仅当 `chatListView === "sessions"` 时生效。
- 任选一种，与现有 `scrollKey`、`sidebarScrollHistory` 的 key 设计一致即可（见下）。

### 4.3 滚动位置 key（scrollKey）

- 当前 `scrollKey` 示例：`"sessions"`（全部普通会话）、`"groups"`、`"group-sessions:${groupId}"`。
- 增加「已收藏」视图后，建议：
  - 全部普通会话：继续使用 `"sessions"`。
  - 已收藏会话：使用新 key，例如 `"sessions-favorited"`。
- 这样在 toggle 两个视图时，各自滚动位置可独立保存与恢复（与现有 `sidebarScrollHistory` 逻辑一致）。

### 4.4 分页状态

- 当前：`sessionPagination` 针对的是 `sessions` 全量（`loadedCount`、`hasMore` 等）。
- 「已收藏」视图的数据源是 `sessions.filter(s => s.isFavorite)`，列表长度可能远小于全量。
- **建议**：
  - 若两种视图**共用一套分页状态**：则切换视图时需根据当前数据源（全部 vs 已收藏）重置/重算 `loadedCount` 与 `hasMore`，避免错位。
  - 更稳妥的方式：**抽象出「当前列表数据源 + 分页」**：例如「当前显示的会话 ID 列表」+ 针对该列表的 `loadedCount` / `hasMore`，这样「全部」与「已收藏」都走同一套分页与 `loadMoreSessions` 逻辑，仅数据源不同。若现有实现尚未抽象，可在本功能中一并抽象以便复用。

---

## 5. 侧边栏底部四按钮布局

- 当前底部结构：左侧为 `sidebar-actions`（设置、组会话），右侧为「新建」按钮；中间 `justify-content: space-between`。
- 增加「已收藏会话」后共**四个**操作按钮：设置、组会话、**已收藏会话**、新建（或：设置、**已收藏会话**、组会话、新建，视产品排序而定）。
- **布局要求**：
  - 在**同一行**内排布，**宽度均分**（或四个按钮等宽、等间距），保证视觉协调。
  - 若空间紧张，可适当**减小按钮间距（gap）**或**略微缩小按钮尺寸**，避免拥挤或换行。
- 实现上可考虑：将四个按钮都放入同一 flex 容器，使用 `flex: 1` 或固定均分宽度；或使用 `grid` 四列均分。具体以现有 `sidebar.module.scss` 中 `.sidebar-tail`、`.sidebar-actions`、`.sidebar-action` 为基础做扩展即可。

---

## 6. 涉及代码位置（便于实现时溯源）

| 层级 | 位置 | 说明 |
|------|------|------|
| 类型与 store | `app/store/chat.ts` | `ChatSession` 增加 `isFavorite?`；默认状态与持久化；可选 `chatListSessionsFilter` 或扩展 `chatListView`；`scrollKey` 在 sidebar 中为 `sessions-favorited` 分支；分页重置/抽象 |
| 侧边栏 | `app/components/sidebar.tsx` | 底部第四按钮「已收藏会话」；`scrollKey` 在 sessions / sessions-favorited 间区分；toggle 逻辑；分页与加载更多在 favorited 视图下的数据源 |
| 会话列表 | `app/components/chat-list.tsx` | 根据当前视图（全部 vs 已收藏）使用不同数据源（`sessions` vs. `sessions.filter(isFavorite)`）；若抽象分页，此处消费「当前列表 + 分页」 |
| 会话编辑 | `app/components/session-editor.tsx` | 仅普通会话时增加一行「收藏/取消收藏」 |
| 右键菜单 | `app/components/session-context-menu.tsx` | 仅普通会话时增加一项「收藏会话」/「取消收藏」，根据 `session.isFavorite` 显示文案 |
| 样式 | `app/styles/sidebar.module.scss` | `.sidebar-tail` / `.sidebar-actions` 四按钮均分与间距 |

---

## 7. 实现顺序建议

1. **数据**：`ChatSession.isFavorite` + 持久化与迁移（旧会话默认为未收藏）。
2. **入口**：SessionEditor 收藏行 + SessionContextMenu 收藏项。
3. **Store 与侧边栏**：视图状态（全部 / 已收藏）、scrollKey、分页抽象（如需要）。
4. **侧边栏 UI**：第四按钮 + 列表数据源切换 + 滚动位置保留。
5. **自测**：收藏/取消、toggle 视图、滚动与分页、多标签同步（若现有机制支持）。

---

## 8. 可选与后续

- 主列表中为已收藏会话增加小图标或样式区分（本提案不强制，可后续迭代）。
- 快捷键、无障碍等可按需要补充。

---

以上为收藏会话功能的提案，确认后再进入具体实现与 PR。
