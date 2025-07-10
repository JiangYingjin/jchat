// 权限验证工具函数
import { useChatStore } from "../store";

// 检查访问码是否有权限
export async function checkAccessCodePermission(
  accessCode: string,
): Promise<boolean> {
  try {
    const response = await fetch("/api/auth-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessCode}`,
      },
      body: JSON.stringify({ check: true }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Auth Check] Failed to check access code:", error);
    return false;
  }
}

// 异步检查当前 accessCode 权限，如果无权限则清空并跳转
export async function checkAndHandleAuth(
  navigate: (path: string) => void,
): Promise<void> {
  const chatStore = useChatStore.getState();
  const accessCode = chatStore.accessCode;

  if (!accessCode) {
    // 如果 accessCode 为空，直接跳转到 auth 页面
    navigate("/auth");
    return;
  }

  // 异步检查权限（不阻塞）
  checkAccessCodePermission(accessCode).then((hasPermission) => {
    if (!hasPermission) {
      // 没有权限，清空 accessCode 并跳转到 auth 页面
      chatStore.update((chat) => {
        chat.accessCode = "";
      });
      navigate("/auth");
    }
  });
}

// 同步检查权限（阻塞）
export async function checkAccessCodeSync(
  accessCode: string,
): Promise<boolean> {
  return await checkAccessCodePermission(accessCode);
}

// 处理未授权响应
export function handleUnauthorizedResponse(
  navigate: (path: string) => void,
): void {
  const chatStore = useChatStore.getState();
  chatStore.update((chat) => {
    chat.accessCode = "";
  });
  navigate("/auth");
}
