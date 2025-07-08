"use client";

require("../polyfill");

import { useState, useEffect } from "react";

import styles from "./home.module.scss";

import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";

import { useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID, DEFAULT_THEME } from "../constant";
import { ErrorBoundary } from "./error";

import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { AuthPage } from "./auth";
import { useAccessStore } from "../store";
import { DataMigration } from "../utils/migration";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={styles["loading-content"] + " no-dark"}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

function useHtmlLang() {
  useEffect(() => {
    // 固定设置为简体中文
    document.documentElement.lang = "zh-Hans";
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

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

function Screen() {
  const location = useLocation();
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isMobileScreen = useMobileScreen();
  const shouldTightBorder = !isMobileScreen;

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  // SwitchThemeColor
  // Adapting Safari's theme-color and changing it according to the path
  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (DEFAULT_THEME.toString().includes("dark")) {
      document.body.classList.add("dark");
    } else if (DEFAULT_THEME.toString().includes("light")) {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (shouldTightBorder || isMobileScreen) {
      if (isHome) {
        metaDescriptionDark?.setAttribute("content", "#1b262a");
        metaDescriptionLight?.setAttribute("content", "#e7f8ff");
      } else {
        metaDescriptionDark?.setAttribute("content", "#1e1e1e");
        metaDescriptionLight?.setAttribute("content", "white");
      }
    } else {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    }
  }, [isHome, shouldTightBorder, isMobileScreen]);

  return (
    <div
      className={
        styles.container +
        ` ${shouldTightBorder ? styles["tight-container"] : styles.container}`
      }
    >
      {isAuth ? (
        <>
          <AuthPage />
        </>
      ) : (
        <>
          <SideBar className={isHome ? styles["sidebar-show"] : ""} />

          <div className={styles["window-content"]} id={SlotID.AppBody}>
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

export function Home() {
  useHtmlLang();

  useEffect(() => {
    useAccessStore.getState().fetch();
  }, []);

  if (!useHasHydrated()) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Screen />
      </Router>
    </ErrorBoundary>
  );
}
