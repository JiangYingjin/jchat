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
        <>
          <SideBar className={isHome ? sidebarStyles["sidebar-show"] : ""} />
          <div
            className={containerStyles["window-content"]}
            id={SlotID.AppBody}
          >
            <Routes>
              <Route path={Path.Home} element={<Chat />} />
              <Route path={Path.Chat} element={<Chat />} />
              <Route path={Path.Settings} element={<Settings />} />
            </Routes>
          </div>
        </>
      )}
    </div>
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
