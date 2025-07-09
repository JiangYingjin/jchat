import { useEffect, useRef, useMemo, useState } from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import AddIcon from "../icons/add.svg";

import { useChatStore } from "../store";

import { DEFAULT_SIDEBAR_WIDTH, Path } from "../constant";

import { Link, useNavigate } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { SearchBar, SearchInputRef } from "./search-bar";

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});

function useHotKey() {
  const chatStore = useChatStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          chatStore.nextSession(-1);
        } else if (e.key === "ArrowDown") {
          chatStore.nextSession(1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

function useSideBar() {
  const isMobileScreen = useMobileScreen();

  useEffect(() => {
    const barWidth = DEFAULT_SIDEBAR_WIDTH;
    const sideBarWidth = isMobileScreen ? "100vw" : `${barWidth}px`;
    document.documentElement.style.setProperty("--sidebar-width", sideBarWidth);
  }, [isMobileScreen]);
}

export function SideBar(props: { className?: string }) {
  const chatStore = useChatStore();

  // sidebar
  useSideBar();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );

  // search bar
  const searchBarRef = useRef<SearchInputRef>(null);
  const [isSearching, setIsSearching] = useState(false);

  const stopSearch = () => {
    setIsSearching(false);
    searchBarRef.current?.clearInput();
  };

  useHotKey();

  return (
    <div
      className={`${styles.sidebar} ${props.className}`}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      <div
        className={
          styles["sidebar-search-bar"] +
          " " +
          (isSearching ? styles["sidebar-search-bar-isSearching"] : "")
        }
      >
        <SearchBar ref={searchBarRef} setIsSearching={setIsSearching} />
      </div>

      {!isSearching && (
        <div
          className={styles["sidebar-body"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              navigate(Path.Home);
            }
          }}
        >
          <ChatList narrow={false} />
        </div>
      )}

      <div className={styles["sidebar-tail"]}>
        <div className={styles["sidebar-actions"]}>
          <div className={styles["sidebar-action"]}>
            <Link to={Path.Settings}>
              <IconButton icon={<SettingsIcon />} shadow />
            </Link>
          </div>
        </div>
        <div>
          <IconButton
            icon={<AddIcon />}
            onClick={() => {
              chatStore.newSession();
              navigate(Path.Chat);
              stopSearch();
            }}
            shadow
          />
        </div>
      </div>
    </div>
  );
}
