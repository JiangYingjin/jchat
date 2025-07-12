const cn = {
  Error: {
    Unauthorized:
      "访问密码不正确或为空，请前往[登录](/#/auth)页输入正确的访问密码。",
  },
  Auth: {
    Title: "访问受限",
    Tips: "请输入访问码",
    Input: "Access Code",
    Confirm: "确认",
  },
  ChatItem: {
    ChatItemCount: (count: number) => `${count} 条对话消息`,
  },
  Chat: {
    SubTitle: (count: number) => `共 ${count} 条对话消息`,
    Thinking: {
      Title: "深度思考",
    },
    EditMessage: {
      Title: "编辑消息记录",
      Topic: {
        Title: "聊天主题",
        SubTitle: "更改当前聊天主题",
      },
    },
    Actions: {
      ChatList: "查看消息列表",
      Export: "导出聊天记录",
      Copy: "复制",
      Stop: "停止",
      Retry: "重试",
      Delete: "删除",
      Edit: "编辑",
      Branch: "分支",
      BranchSuccess: "已分支到新会话",
      BranchFailed: "分支会话失败，请重试",
      RefreshTitle: "刷新标题",
      RefreshToast: "已发送刷新标题请求",
    },
    InputActions: {
      UploadImage: "上传图片",
      UploadFle: "上传文件",
      Stop: "停止",
    },
    DeleteMessageToast: "消息已删除",
    DeleteGroupToast: "组已删除",
    Revert: "撤销",
  },
  Export: {
    Title: "分享聊天记录",
    Copy: "复制",
    Download: "下载",
    MessageFromUser: "用户",
    MessageFromModel: "模型",
    MessageFromSystem: "系统",
    Format: {
      Title: "导出格式",
      SubTitle: "可以导出 Markdown 文本或者 PNG 图片",
    },
    IncludeContext: {
      Title: "包含面具上下文",
      SubTitle: "是否在消息中展示面具上下文",
    },
    Steps: {
      Select: "对话选取",
      Preview: "预览导出",
    },
    Image: {
      Toast: "正在生成截图",
      Modal: "图片预览",
    },
    Artifacts: {
      Title: "分享页面",
      Error: "分享失败",
    },
  },
  Select: {
    Search: "搜索消息",
    All: "选取全部",
    Clear: "清除选中",
  },
  Home: {
    DeleteChat: "确认删除选中的对话？",
    DeleteToast: "已删除会话",
    Revert: "撤销",
    Search: "搜索聊天",
  },
  Settings: {
    Title: "设置",
    SubTitle: "所有设置选项",
    ShowPassword: "显示密码",
    LocalData: {
      LocalState: "本地数据",
      Overview: (overview: any) => {
        return `${overview.chat} 组对话，${overview.message} 条消息`;
      },
      ImportFailed: "导入失败",
    },
  },
  Store: {
    DefaultTitle: "新的会话",
    Prompt: {
      History: (content: string) => "这是历史聊天总结作为前情提要：" + content,
      Topic:
        "简要概述上述对话主题，字数5~7字以内，纯文本，不要解释、不要标点、不要语气词、不要多余文本、不要加粗",
      // "使用四到五个字直接返回这句话的简要主题，不要解释、不要标点、不要语气词、不要多余文本，不要加粗，如果没有主题，请直接返回"闲聊"",
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
    Toast: (x: any) => `包含 ${x} 条预设提示词`,
    Edit: "当前对话设置",
    Add: "新增一条对话",
    Clear: "上下文已清除",
    Revert: "恢复上下文",
  },
  UI: {
    Confirm: "确认",
    Cancel: "取消",
    Close: "关闭",
    Create: "新建",
    Edit: "编辑",
    Export: "导出",
    Import: "导入",
    Config: "配置",
  },
  Exporter: {
    Model: "模型",
    Time: "时间",
  },
};

export default cn;
