"use client";

// 1. Imports
// -----------------------------------------------------------------------------
// 外部库
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";

// 内部组件
import { ErrorBoundary } from "./error";
import { FileDropZone } from "./file-drop-zone";
import { SideBar } from "./sidebar";
import { ClipboardManager } from "./clipboard-manager";

// 状态管理和自定义 Hooks
import { useChatStore } from "../store";
import { useMobileScreen } from "../utils";
import { useAppReady } from "../hooks/app-ready";

// 常量和工具函数
import { Path, SlotID, DEFAULT_THEME } from "../constant";
import { checkAndHandleAuth } from "../utils/auth";
import { storageManager } from "../utils/storage-manager";

// 静态资源
import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";
import containerStyles from "../styles/container.module.scss";
import sidebarStyles from "../styles/sidebar.module.scss";
import groupSessionsStyles from "../styles/group-sessions.module.scss";

// 2. 组件导入
// -----------------------------------------------------------------------------
import { Settings } from "./settings";
import { ChatPage as Chat } from "./chat";
import { AuthPage as AuthComponent } from "./auth";

// 3. 辅助/工具组件
// -----------------------------------------------------------------------------
export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={groupSessionsStyles["loading-content"] + " no-dark"}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

// 4. 自定义 Hooks 和辅助函数
// -----------------------------------------------------------------------------
/**
 * 设置文档根元素的语言属性
 */
function useHtmlLang() {
  useEffect(() => {
    document.documentElement.lang = "zh-Hans";
  }, []);
}

/**
 * 检查客户端是否已完成水合 (Hydration)，避免 SSR 不匹配问题
 */
const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

// 移除本地的 useAppReady 函数，使用导入的 Hook

/**
 * 异步加载 Google 字体
 */
const loadAsyncGoogleFont = () => {
  const linkEl = document.createElement("link");
  const proxyFontUrl = "/google-fonts";
  linkEl.rel = "stylesheet";
  linkEl.href =
    proxyFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

// 5. 核心业务/布局组件
// -----------------------------------------------------------------------------
/**
 * Screen 组件负责页面的主布局、路由和主题切换逻辑
 */
function Screen() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === Path.Home;
  const isAuth = pathname === Path.Auth;
  const isMobileScreen = useMobileScreen();
  const shouldTightBorder = !isMobileScreen;

  // 异步加载字体
  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  // 权限检查
  useEffect(() => {
    // 只在非 auth 页面进行权限检查
    if (!isAuth) {
      checkAndHandleAuth(() => router.push(Path.Auth));
    }
  }, [pathname, router, isAuth]);

  // 主题颜色和 Safari theme-color 适配
  useEffect(() => {
    document.body.classList.remove("light", "dark");
    if (DEFAULT_THEME.toString().includes("dark")) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    let darkContent = "#151515";
    let lightContent = "#fafafa";

    if (shouldTightBorder || isMobileScreen) {
      if (isHome) {
        darkContent = "#1b262a";
        lightContent = "#e7f8ff";
      } else {
        darkContent = "#1e1e1e";
        lightContent = "white";
      }
    }

    metaDescriptionDark?.setAttribute("content", darkContent);
    metaDescriptionLight?.setAttribute("content", lightContent);
  }, [isHome, shouldTightBorder, isMobileScreen]);

  return (
    <div
      className={
        containerStyles.container +
        ` ${shouldTightBorder ? containerStyles["tight-container"] : containerStyles.container}`
      }
    >
      {isAuth ? (
        <AuthComponent />
      ) : (
        <MobileAwareLayout isHome={isHome} isMobileScreen={isMobileScreen} />
      )}
    </div>
  );
}

// 4.5 移动端感知布局组件
// -----------------------------------------------------------------------------
/**
 * MobileAwareLayout 组件负责移动端的单屏切换逻辑
 */
function MobileAwareLayout({
  isHome,
  isMobileScreen,
}: {
  isHome: boolean;
  isMobileScreen: boolean;
}) {
  const chatStore = useChatStore();
  const router = useRouter();
  const pathname = usePathname();
  const mobileViewState = useChatStore((state) => state.mobileViewState);

  // 移动端初始化：确保初次进入时显示侧边栏
  useEffect(() => {
    if (isMobileScreen && typeof window !== "undefined") {
      // 移动端初始化：确保总是从侧边栏开始
      chatStore.showSidebarOnMobile();

      // 建立正确的历史记录状态
      window.history.replaceState(
        { mobileView: "sidebar", canExit: true },
        "",
        pathname,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen]); // 只依赖isMobileScreen，避免chatStore导致的循环

  // 移动端历史记录管理 - 简化版本
  useEffect(() => {
    if (!isMobileScreen || typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      // 如果当前在聊天界面或设置界面，拦截返回操作并跳转到侧边栏
      if (mobileViewState === "chat" || mobileViewState === "settings") {
        event.preventDefault();
        event.stopPropagation();

        // 切换到侧边栏状态
        chatStore.showSidebarOnMobile();

        // 添加一个新的历史记录条目，确保用户在侧边栏时再次返回才会退出应用
        window.history.pushState(
          { mobileView: "sidebar", canExit: true },
          "",
          pathname,
        );

        return;
      }

      // 如果在侧边栏界面，允许正常的返回行为（退出应用）
      // 这里不需要阻止默认行为，让浏览器正常处理
    };

    // 监听浏览器返回按钮和全面屏手势
    window.addEventListener("popstate", handlePopState);

    // 当切换到聊天界面或设置界面时的历史记录管理
    if (mobileViewState === "chat" || mobileViewState === "settings") {
      // 检查当前历史记录状态，避免重复添加
      const currentState = window.history.state;
      if (!currentState || currentState.mobileView !== mobileViewState) {
        // 添加聊天界面或设置界面的历史记录条目
        window.history.pushState(
          { mobileView: mobileViewState, canExit: false },
          "",
          pathname,
        );
      }
    } else if (mobileViewState === "sidebar") {
      // 当在侧边栏时，确保历史记录状态正确
      const currentState = window.history.state;
      if (!currentState || currentState.mobileView !== "sidebar") {
        // 替换当前历史记录，标记为可以退出
        window.history.replaceState(
          { mobileView: "sidebar", canExit: true },
          "",
          pathname,
        );
      }
    }

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [mobileViewState, isMobileScreen, chatStore, pathname]);

  // 移动端：根据mobileViewState决定显示哪个界面
  if (isMobileScreen) {
    if (mobileViewState === "sidebar") {
      return <SideBar className={sidebarStyles["sidebar-show"]} />;
    } else if (mobileViewState === "settings") {
      return (
        <div className={containerStyles["window-content"]} id={SlotID.AppBody}>
          <Settings />
        </div>
      );
    } else {
      return (
        <div className={containerStyles["window-content"]} id={SlotID.AppBody}>
          <Chat />
        </div>
      );
    }
  }

  // 桌面端：保持原有的分屏布局
  return (
    <>
      <SideBar className={isHome ? sidebarStyles["sidebar-show"] : ""} />
      <div className={containerStyles["window-content"]} id={SlotID.AppBody}>
        {pathname === Path.Settings ? (
          <Settings />
        ) : pathname === Path.Chat ? (
          <Chat />
        ) : pathname === Path.Auth ? (
          <AuthComponent />
        ) : (
          <Chat />
        )}
      </div>
    </>
  );
}

// 6. 主导出组件 (文件入口)
// -----------------------------------------------------------------------------
export function Home() {
  useHtmlLang();

  // 🔥 新增：使用应用准备状态检查
  const hasHydrated = useHasHydrated();
  const {
    isReady: isAppReady,
    isInitialized: appInitialized,
    error,
  } = useAppReady();

  // 应用启动时获取全局数据并初始化存储健康检查
  useEffect(() => {
    useChatStore.getState().fetchModels();

    // 延迟启动存储健康检查，确保应用已经完全初始化
    const timer = setTimeout(() => {
      const initializeStorageHealth = async () => {
        try {
          await storageManager.quickHealthCheck();
        } catch (error) {
          console.warn(
            "[Home] 存储健康检查初始化失败，但不影响应用运行:",
            error,
          );
        }
      };
      initializeStorageHealth();
    }, 1000); // 延迟1秒，确保应用完全加载

    return () => clearTimeout(timer);
  }, []);

  // 🔥 优化加载逻辑：分阶段显示加载状态
  // 1. 等待客户端水合完成（避免 SSR 不匹配）
  if (!hasHydrated) {
    return <Loading />;
  }

  // 2. 等待应用数据准备完成（数据完整性、一致性检查）
  if (!appInitialized || !isAppReady) {
    return <Loading />;
  }

  // 3. 应用完全准备就绪，开始渲染界面
  return (
    <ErrorBoundary>
      <ClipboardManager>
        <FileDropZone>
          <Screen />
        </FileDropZone>
      </ClipboardManager>
    </ErrorBoundary>
  );
}
