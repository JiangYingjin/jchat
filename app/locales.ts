const cn = {
  Auth: {
    Title: "访问受限",
    Tips: "请输入访问码",
    Input: "Access Code",
    Confirm: "确认",
  },
  ChatItem: {
    ChatItemCount: (count: number) => `${count} 条消息`,
  },
  Session: {
    Title: {
      Default: "新的会话",
      DefaultGroup: "新的组会话",
      RefreshPrompt:
        "简要概述上述对话主题，字数5~7字以内，纯文本，不要解释、不要标点、不要语气词、不要多余文本、不要加粗",
    },
  },
  Chat: {
    SubTitle: (count: number) => `共 ${count} 条消息`,
    Thinking: {
      Title: "深度思考",
    },
    EditSession: {
      Title: "会话编辑",
      SessionTitle: {
        Title: "会话标题",
        SubTitle: "更改当前会话标题",
      },
    },
    Actions: {
      Export: "导出",
      Copy: "复制",
      Stop: "停止",
      Retry: "重试",
      Delete: "删除",
      Edit: "编辑",
      Branch: "分支",
      BranchFailed: "分支会话失败，请重试",
      RefreshTitle: "刷新标题",
      RefreshTitleToast: "正在刷新标题中",
      UpdateTitle: "更新标题",
      GenerateTitle: "生成标题",
      GeneratingTitle: "生成标题中 ...",
      TitleGenerated: "标题已更新",
      BatchApply: "应用",
      BatchDelete: "批量删除",
      BatchDeleteFailed: "批量删除失败，请重试",
    },
    InputActions: {
      UploadImage: "上传图片",
      Stop: "停止",
      UseMemory: "用户记忆",
    },
    DeleteMessageToast: "消息已删除",
    DeleteSessionToast: "会话已删除",
    DeleteLastGroupSessionToast: "会话已删除，右键可删除组会话",
    DeleteGroupToast: "组已删除",
    BatchDeleteToast: "批量删除完成",
    Revert: "撤销",
    Merge: {
      Title: "待合并会话",
      Confirm: "确认合并",
      Cancel: "取消",
      MessagesCount: (n: number) => `${n} 条消息`,
    },
  },
  Export: {
    Title: "会话分享/导出",
    Copy: "复制",
    Download: "下载",
    User: "用户",
    Modal: "模型",
    System: "系统",
    Format: {
      Title: "导出格式",
      SubTitle: "可导出为 Markdown 文本、PNG 图片等格式",
    },
    Steps: {
      Select: "消息选取",
      Preview: "预览导出",
    },
    Image: {
      Toast: "生成截图中",
      Modal: "图片预览",
    },
    ShareLink: "分享为链接",
    LinkCopied: "链接已复制",
    ShareFailed: "分享失败",
  },
  Select: {
    Search: "搜索消息",
    All: "选取全部",
    Clear: "清除选中",
  },
  Search: {
    Title: "搜索聊天",
  },
  Settings: {
    Title: "设置",
    SubTitle: "所有设置选项",
    LocalData: {
      LocalState: "本地数据",
      Overview: (overview: any) => {
        return `${overview.chat} 组对话，${overview.message} 条消息`;
      },
      ImportFailed: "导入失败",
    },
    Mem0: {
      Title: "用户标识",
      SubTitle: "启用并唯一标识 Mem0 用户记忆等（可选）",
      Placeholder: "用户标识（可选）",
    },
    OverrideApiKey: {
      Title: "API Key",
      SubTitle: "覆盖服务器端默认密钥以调用专用模型（可选）",
      Placeholder: "可选",
    },
    AutoBackup: {
      Title: "定时备份到本地文件夹",
      SubTitle: "将数据定期写入您选择的目录（需 Chrome/Edge，数据存于本机）",
      SelectDirectory: "选择备份目录",
      DirectorySelected: "已选择备份目录",
      DirectoryNotSelected: "未选择",
      Enable: "开启定时自动备份",
      Interval: "备份间隔",
      Interval1h: "每 1 小时",
      Interval6h: "每 6 小时",
      Interval24h: "每 24 小时",
      MaxCount: "最多保留份数",
      Unsupported: "当前浏览器不支持选择目录，请使用 Chrome 或 Edge",
      Saved: "备份目录已保存",
      WriteFailed: "写入备份失败",
    },
  },
  Copy: {
    Success: "已写入剪切板",
    Failed: "复制失败，请赋予剪切板权限",
  },
  Download: {
    Success: "内容已下载到您的目录。",
    Failed: "下载失败。",
  },
  Context: {
    Add: "新增一条对话",
  },
  UI: {
    Confirm: "确认",
    Cancel: "取消",
    Close: "关闭",
    Export: "导出",
    Import: "导入",
  },
  Exporter: {
    Model: "模型",
    Time: "时间",
    Title: "主题",
  },
  Store: {
    MessageNotFound: "部分聊天记录加载失败，可能已损坏或被意外删除。",
    MessageLoadFailed: "聊天记录加载失败，请检查网络或刷新页面重试。",
  },
};

export default cn;
