"use client";

// 1. Imports
// -----------------------------------------------------------------------------
// 外部库
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";

// 内部组件
import { ErrorBoundary } from "./error";
import { FileDropZone } from "./file-drop-zone";
import { SideBar } from "./sidebar";
import { AuthPage } from "./auth";

// 状态管理和自定义 Hooks
import { useChatStore } from "../store";
import { useMobileScreen } from "../utils";

// 常量和工具函数
import { Path, SlotID, DEFAULT_THEME } from "../constant";
import { checkAndHandleAuth } from "../utils/auth";

// 静态资源
import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";
import containerStyles from "../styles/container.module.scss";
import sidebarStyles from "../styles/sidebar.module.scss";
import groupSessionsStyles from "../styles/group-sessions.module.scss";

// 2. 动态组件导入 (Code Splitting)
// -----------------------------------------------------------------------------
const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).ChatPage, {
  loading: () => <Loading noLogo />,
});

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
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
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
      checkAndHandleAuth(navigate);
    }
  }, [location.pathname, navigate, isAuth]);

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
        <AuthPage />
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
  const navigate = useNavigate();
  const location = useLocation();
  const mobileViewState = useChatStore((state) => state.mobileViewState);

  // 移动端初始化：确保初次进入时显示侧边栏
  useEffect(() => {
    if (isMobileScreen) {
      // 移动端初始化：无论当前状态如何，都重置为侧边栏状态
      chatStore.showSidebarOnMobile();
    }
  }, [isMobileScreen]); // 只依赖isMobileScreen，避免chatStore导致的循环

  // 移动端历史记录管理
  useEffect(() => {
    if (!isMobileScreen) return;

    const handlePopState = (event: PopStateEvent) => {
      // 检查是否在聊天界面，如果是，则返回到侧边栏
      if (mobileViewState === "chat") {
        event.preventDefault();
        chatStore.showSidebarOnMobile();
        // 添加一个新的历史记录条目，避免用户直接退出应用
        window.history.pushState(
          { mobileView: "sidebar" },
          "",
          location.pathname,
        );
      }
    };

    // 监听浏览器返回按钮
    window.addEventListener("popstate", handlePopState);

    // 当切换到聊天界面时，添加历史记录条目
    if (mobileViewState === "chat") {
      window.history.pushState({ mobileView: "chat" }, "", location.pathname);
    }

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [mobileViewState, isMobileScreen, chatStore, location.pathname]);

  // 移动端：根据mobileViewState决定显示哪个界面
  if (isMobileScreen) {
    if (mobileViewState === "sidebar") {
      return <SideBar className={sidebarStyles["sidebar-show"]} />;
    } else {
      return (
        <div className={containerStyles["window-content"]} id={SlotID.AppBody}>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
          </Routes>
        </div>
      );
    }
  }

  // 桌面端：保持原有的分屏布局
  return (
    <>
      <SideBar className={isHome ? sidebarStyles["sidebar-show"] : ""} />
      <div className={containerStyles["window-content"]} id={SlotID.AppBody}>
        <Routes>
          <Route path={Path.Home} element={<Chat />} />
          <Route path={Path.Chat} element={<Chat />} />
          <Route path={Path.Settings} element={<Settings />} />
        </Routes>
      </div>
    </>
  );
}

// 6. 主导出组件 (文件入口)
// -----------------------------------------------------------------------------
export function Home() {
  useHtmlLang();

  // 应用启动时获取全局数据
  useEffect(() => {
    useChatStore.getState().fetchModels();
  }, []);

  // 等待客户端水合完成，以显示正确的 UI
  if (!useHasHydrated()) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <FileDropZone>
        <Router>
          <Screen />
        </Router>
      </FileDropZone>
    </ErrorBoundary>
  );
}
