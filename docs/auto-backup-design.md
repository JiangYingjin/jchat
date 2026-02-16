# JChat 定时自动备份设计方案

## 背景与目标

- 现有能力见 [数据备份系统](./data-backup-system.md)：支持手动「导出/导入」完整 IndexedDB 数据，格式为 `JChatBackupData`，导出为文件下载。
- **目标**：在现有备份能力之上，增加**定时自动备份**，减少用户忘记备份导致的数据丢失风险；不改变现有手动导出/导入流程。

## 约束与前提

- JChat 为**纯前端**应用，数据仅存于浏览器 IndexedDB，无服务端存储。
- 自动备份只能在**当前浏览器环境**内执行（页面打开时由前端定时器触发）。
- 不强制触发文件下载（避免打扰用户），因此自动备份结果应存于**应用内部**，便于后续「从自动备份恢复」或导出为文件。

## 方案概览

| 维度       | 设计 |
|------------|------|
| 触发方式   | 应用内 `setInterval`（或 requestIdleCallback / 固定间隔），仅在「自动备份已开启」且页面处于前台或可运行状态时执行。 |
| 存储位置   | 新增 IndexedDB 存储桶 `autoBackups`，每条备份以 `timestamp` 为键，值为与现有格式一致的 `JChatBackupData`（或仅 `data` + `metadata` + `version`，便于与现有导入逻辑复用）。 |
| 保留策略   | 可配置「最多保留 N 份」（如 5/10/20），超过时按时间戳删除最旧的。 |
| 用户入口   | 设置页「本地状态」下：① 开关「定时自动备份」；② 间隔（如 1 小时 / 6 小时 / 24 小时）；③ 保留份数；④ 可选「从自动备份恢复」列表（按时间展示，选择后恢复）。 |
| 与手动导出关系 | 手动「导出」仍为下载文件，逻辑不变；自动备份仅写入 `autoBackups`，用户若需要文件可再在「从自动备份恢复」处对某条备份做「导出为文件」。 |

## 详细设计

### 1. 数据层

- **存储**：使用 localforage 新建实例 `storeName: "autoBackups"`，与现有 `default` / `messages` / `systemMessages` / `chatInput` 并列。
- **单条结构**：与 `JChatBackupData` 一致（含 `version`、`timestamp`、`metadata`、`data`），便于直接复用 `importData` 的验证与恢复逻辑。
- **键**：`String(timestamp)` 或 `backup_${timestamp}`，便于按时间排序与淘汰。

### 2. 配置持久化

- 以下配置需持久化（可放在现有 `default` 存储桶的某 key 下，或单独 key）：
  - `autoBackupEnabled: boolean`
  - `autoBackupIntervalMinutes: number`（如 60 / 360 / 1440）
  - `autoBackupMaxCount: number`（如 5 / 10 / 20）
- 应用启动时读取配置，若开启则启动定时器；设置页修改后保存并**重新设定定时器**（清除旧 interval，按新间隔重设）。

### 3. 定时逻辑

- 进入应用（或从后台恢复）时：若 `autoBackupEnabled === true`，则：
  - 可选：首次延迟 1–2 分钟再执行第一次自动备份，避免启动瞬间与其它 IO 争抢。
  - 使用 `setInterval(intervalMs)` 周期性执行「自动备份任务」。
- 自动备份任务逻辑：
  1. 与当前 `exportData()` 复用同一套「读取 4 个存储桶 → 构建 JChatBackupData」；
  2. 不调用 `downloadBlob`，改为将 `backupData` 写入 `autoBackups`，键为 `String(backupData.timestamp)`；
  3. 读取当前 `autoBackups` 下所有键，按时间戳排序，若数量 > `autoBackupMaxCount`，则删除最旧的若干条直至 ≤ maxCount。
- 页面不可见时（如 `document.visibilityState === "hidden"`）：可选择暂停定时器或继续执行（建议：继续执行但降低频率或仅在下次可见时补跑一次，以简化实现可先采用「不暂停」）。

### 4. 恢复与导出

- **从自动备份恢复**：
  - 从 `autoBackups` 列出所有键（时间戳），按时间倒序展示；
  - 用户选择某条后，取出对应 `JChatBackupData`，复用现有 `importData` 的「验证 → 写入 4 个存储桶 → 重载」流程（可抽成 `restoreFromBackupData(backupData)` 供手动导入与自动备份共用）。
- **将某条自动备份导出为文件**：用现有 `downloadBlob` + 与 `exportData()` 相同的文件名规则，仅数据来源改为该条 `autoBackups` 条目。

### 5. 实现顺序建议

1. **data-manager 扩展**  
   - 新增 `exportDataToAutoBackup(): Promise<void>`：构建 JChatBackupData，写入 `autoBackups`，再按 maxCount 淘汰。  
   - 新增 `listAutoBackups(): Promise<{ timestamp: number }[]>`。  
   - 新增 `getAutoBackup(timestamp: number): Promise<JChatBackupData | null>`。  
   - 新增 `restoreFromBackupData(data: JChatBackupData): Promise<void>`（从现有 `importData` 中抽离「验证 + 写 4 桶 + 重载」）。  
   - 可选：`exportAutoBackupToFile(timestamp: number)` 用于将某条自动备份下载为文件。

2. **配置与定时器**  
   - 在 chat store 或单独模块中持久化 `autoBackupEnabled`、`autoBackupIntervalMinutes`、`autoBackupMaxCount`。  
   - 应用根组件或某全局入口：在 mount 时若开启则 `setInterval` 调用 `exportDataToAutoBackup`，unmount 时 clearInterval；提供「重新设置定时器」方法供设置页在修改配置后调用。

3. **设置页 UI**  
   - 在「本地状态」下增加：自动备份开关、间隔下拉、保留份数输入/下拉；保存时写回配置并触发「重新设置定时器」。

4. **从自动备份恢复的 UI**  
   - 在设置页增加「从自动备份恢复」区块：请求 `listAutoBackups()`，展示列表；选择后确认，调用 `restoreFromBackupData`；可选每条提供「导出为文件」按钮。

### 6. 与现有文档的衔接

- [数据备份系统](./data-backup-system.md) 中「定期备份」改为：建议开启「定时自动备份」并定期将重要备份「导出为文件」做异地保存。
- 本设计仅描述「定时自动备份」的行为与实现要点，具体 API 命名与文件结构以代码为准，本文档随实现可做小幅修订。

## 可选增强（后续）

- 可见性感知：`visibilitychange` 时暂停/恢复定时器，或仅在可见时执行，减少后台 tab 的 CPU/IO。
- 压缩：与手动导出一致，写入 `autoBackups` 时也可存 gzip 字节，读取时解压再解析，节省空间。
- 提醒：若距离上次自动备份已过 N 倍间隔却未执行（例如 tab 长期后台被节流），在用户回到页面时提示「自动备份可能滞后，建议手动导出一次」。

---

**文档版本**：v1  
**关联**：[data-backup-system.md](./data-backup-system.md)
