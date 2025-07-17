// 权限验证工具函数
import { useChatStore, isStoreHydrated, waitForHydration } from "../store/chat";

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

// 等待 store 完成 hydration
function waitForStoreHydration(timeout: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (isStoreHydrated()) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      resolve(false);
    }, timeout);

    waitForHydration()
      .then(() => {
        clearTimeout(timeoutId);
        resolve(true);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        resolve(false);
      });
  });
}

// 异步检查当前 accessCode 权限，如果无权限则清空并跳转
export async function checkAndHandleAuth(navigate: () => void): Promise<void> {
  // 等待 store 完成 hydration
  await waitForStoreHydration();

  const chatStore = useChatStore.getState();
  const accessCode = chatStore.accessCode;

  if (!accessCode) {
    // 如果 accessCode 为空，直接跳转到 auth 页面
    navigate();
    return;
  }

  // 异步检查权限（不阻塞）
  checkAccessCodePermission(accessCode)
    .then((hasPermission) => {
      if (!hasPermission) {
        // 没有权限，清空 accessCode 并跳转到 auth 页面
        chatStore.update((chat) => {
          chat.accessCode = "";
        });
        navigate();
      }
    })
    .catch((error) => {
      console.error("[Auth Check] Error during permission check:", error);
      // 发生错误时也清空并跳转，保证安全
      chatStore.update((chat) => {
        chat.accessCode = "";
      });
      navigate();
    });
}

// 同步检查权限（阻塞）
export async function checkAccessCodeSync(
  accessCode: string,
): Promise<boolean> {
  return await checkAccessCodePermission(accessCode);
}

// 处理未授权响应
export function handleUnauthorizedResponse(navigate: () => void): void {
  const chatStore = useChatStore.getState();
  chatStore.update((chat) => {
    chat.accessCode = "";
  });
  navigate();
}

// 处理URL中的认证码参数
export async function handleUrlAuthCode(
  searchParams: URLSearchParams,
  router: { push: (path: string) => void; replace: (path: string) => void },
  navigate: () => void,
): Promise<void> {
  const foundCode = searchParams.get("code");

  // 如果找到了code，立即验证权限
  if (foundCode) {
    console.log("[Auth] got code from url: ", foundCode);

    // 清除URL中的code参数
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("code");
    if (typeof window !== "undefined") {
      const newUrl =
        window.location.pathname +
        (newParams.toString() ? "?" + newParams.toString() : "");
      router.replace(newUrl);
    }

    const hasPermission = await checkAccessCodePermission(foundCode);
    const chatStore = useChatStore.getState();

    if (hasPermission) {
      // 有权限，设置accessCode
      chatStore.update((chat) => (chat.accessCode = foundCode!));
    } else {
      // 没有权限，清空accessCode并跳转到auth页面
      chatStore.update((chat) => (chat.accessCode = ""));
      navigate();
    }
  }
}
