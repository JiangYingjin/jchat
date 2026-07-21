<div align="center">

# JChat

<a href="https://chat.jyj.cx"><img src="https://img.shields.io/badge/在线演示-chat.jyj.cx-1e88e5?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJzNC40OCAxMCAxMCAxMCAxMC00LjQ4IDEwLTEwUzE3LjUyIDIgMTIgMnptLTEgMTcuOTNjLTUuMDUtLjU0LTktNS4wNS05LTEwLjA3IDAtMS4wNC4xNC0yLjA0LjQtM2wyLjg2IDIuODVhMy45OSAzLjk5IDAgMCAwIDUuNjYgNS42NmwyLjg2IDIuODVjLS45Ni4yNi0xLjk2LjQtMyAuNDF6bTYuMjUtMy44NGE0IDQgMCAwIDAtNS42Ni01LjY2bC0yLjg2LTIuODVjLjk2LS4yNiAxLjk2LS40IDMtLjQxIDUuMDUuNTQgOSA1LjA1IDkgMTAuMDcgMCAxLjA0LS4xNCAyLjA0LS40IDIuOTdsLTIuODUtMi44NnoiLz48L3N2Zz4=" alt="Live Demo"></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-4caf50?style=flat-square" alt="License: MIT"></a>
<a href="https://github.com/ChatGPTNextWeb/NextChat"><img src="https://img.shields.io/badge/基于-NextChat-9c27b0?style=flat-square" alt="Based on NextChat"></a>

</div>

<br>

<p align="center">基于 NextChat (ChatGPT-Next-Web) 的 AI 聊天客户端二次开发。</p>

<p align="center">本地优先，数据自管，百万上下文编辑，AST 搜索引擎。</p>

<br>

---

## 📋 背景

上游 NextChat 在轻量使用场景下表现良好，但随着使用强度的增加——几个核心体验问题逐渐显现：

- **数据存储**：上游将整个应用状态序列化为单 blob 存入 IndexedDB。每次状态变更（切换会话、发送消息、修改设置）都要全量读写整个 blob，数据量越大，启动速度和操作响应越慢。
- **上下文编辑**：原生 textarea 在数万词元的系统提示词编辑中与 React 状态更新耦合，导致明显卡顿。
- **会话检索**：数千个会话累积后，简单的列表滚动和文字过滤无法快速定位历史。
- **会话管理**：基础 CRUD 操作无法满足分支探索、误删恢复、多会话合并等日常需求。

本 fork 针对这些问题，在保留上游交互框架的前提下，对存储、编辑器、搜索、会话管理等基础设施做了系统性的重构与增强。

---

## 🔧 核心改进

### 🗄️ 数据存储

上游将整个应用状态序列化为单 blob 存入 IndexedDB，每次操作触发全量读写，数据量增长后响应迟滞明显。改为了元数据、消息体、系统提示词、输入草稿四桶分离的架构，消息按需懒加载。操作响应与数据总量解耦，无论是 10MB 还是 100MB 的数据量，体验一致。

配套完整的会话导出导入和定时自动备份机制。

### ✏️ 上下文编辑

上游使用原生 textarea 作为输入组件，在数万词元的系统提示词编辑场景下与 React 状态更新耦合，卡顿明显。集成了 Monaco Editor（VS Code 的 Web 编辑器核心），虚拟化渲染使编辑性能与文档长度解耦，无论上下文多长都保持流畅。系统提示词中可附加多张图片。

### 💬 会话管理

上游的会话操作限于基础增删改。日常使用中逐步扩展为多个功能：

- **分支**：从长对话的任意消息点分出新会话，原会话保留，命名自动递增
- **合并**：多选会话后按拖拽顺序合并为一个新会话
- **删除撤回**：误删后可撤销恢复
- **收藏与排序**：标记重要会话，拖拽调整列表顺序，列表背景色深度指示消息数量
- **性能指标**：展示 TTFT、Cost、TPS 等接口指标
- **滚动恢复**：离开后自动恢复精确滚动位置
- **其他**：消息编辑、标题 LLM 自动生成、右键菜单等

### 🔗 分享系统

将会话生成为短链接分享给他人。基于本机 MongoDB 存储，搜索栏中粘贴链接自动识别并导入——当前会话为空则覆盖，非空则新建。支持 Markdown 和图片格式的会话导出。

### 🔍 搜索引擎

上游搜索基于简单的子串匹配，缺少组合查询能力。实现了一组搜索语法：空格分隔的词做 AND 逻辑，`|` 做 OR，`"引号"` 做精确匹配，`标题:` 限定搜索范围。查询经 AST 求值后执行，结果中的关键词按相关性高亮显示。


---

## 📊 与上游对比
| 维度 | NextChat | JChat |
|------|----------|-------|
| 数据存储 | 单 blob 全量序列化，localStorage 降级 | 四桶分离，按需懒加载 |
| 编辑器 | 原生 textarea | Monaco Editor，虚拟化渲染 |
| 搜索 | 子串匹配 | AST 语法（AND / OR / 标题 / 精确匹配） |
| 会话操作 | 基础 CRUD | 分支 / 撤回 / 合并 / 收藏 / 拖拽排序 |
| 性能指标 | — | TTFT / Cost / TPS 展示 |
| 分享 | — | MongoDB 短链，搜索栏导入 |
| 数据备份 | — | 导出导入 + 定时自动备份 |
| 视觉辅助 | — | 背景色指示消息数量 |

---

## 📋 功能速览
| 功能 | 说明 |
|------|------|
| 本地数据管理 | IndexedDB 四桶存储，160MB+ 数据按需加载，导出导入自动备份 |
| Monaco 编辑器 | 虚拟化渲染，支持长文本编辑与图像附件 |
| 会话管理 | 分支、删除撤回、合并、收藏、拖拽排序、标题管理、滚动恢复、消息编辑 |
| 搜索引擎 | AST 搜索语法，支持 AND/OR/标题/精确匹配组合查询 |
| 分享 | MongoDB 短链，搜索栏粘贴即导入 |
| 指标展示 | TTFT / Cost / TPS |
| 长输入模式 | Shift+Enter 切换，适用于编写较长提示词的场景 |
| 模型配置 | 默认 / 长文 / 组会话 / 标题生成四路独立模型 |
| 移动端适配 | 支持移动端独立导航操作 |
| 主题 | 亮色 / 深色 / 跟随系统 |
| 国际化 | 简体中文、英文 |

---

## 🚀 快速开始
```bash
git clone https://github.com/JiangYingjin/jchat.git
cd jchat
pnpm install
```

创建 `.env.local`：

```dotenv
API_KEY="sk-or-v1-..."
BASE_URL="https://openrouter.ai/api/v1"
MODELS="openai/gpt-5.6-luna,anthropic/claude-sonnet-5,google/gemini-3.1-flash"
```

启动开发服务器：

```bash
pnpm dev
```

访问 `http://localhost:3000`。

---

## 🛠️ 技术栈
| 层 | 选型 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| UI | React 19 |
| 状态管理 | Zustand 5 |
| 本地存储 | IndexedDB via `localforage` |
| 代码编辑器 | Monaco Editor |
| 搜索引擎 | AST 解析引擎 |
| 分享数据库 | MongoDB via `mongoose` |
| Markdown | react-markdown + remark-gfm + rehype-katex |
| 图表 | Mermaid |
| 拖拽 | @dnd-kit |
| 国际化 | 自定义实现，中英双语 |

---

## 🔗 相关链接
- 在线演示：[chat.jyj.cx](https://chat.jyj.cx)
- 上游仓库：[ChatGPTNextWeb/NextChat](https://github.com/ChatGPTNextWeb/NextChat)
