import { useEffect, useRef, useState } from "react";

import styles from "./home.module.scss";
import buttonStyles from "./button.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import AddIcon from "../icons/add.svg";
import GroupIcon from "../icons/group.svg";

import { useChatStore } from "../store";

import { DEFAULT_SIDEBAR_WIDTH, Path } from "../constant";

import { useNavigate, useLocation } from "react-router-dom";
import { useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { SearchBar, SearchInputRef } from "./search-bar";
import { createEmptyGroup } from "../utils/group";

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
  const location = useLocation(); // 新增这一行

  // search bar
  const searchBarRef = useRef<SearchInputRef>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isGroupMode, setIsGroupMode] = useState(false);

  const stopSearch = () => {
    setIsSearching(false);
    searchBarRef.current?.clearInput();
  };

  const toggleGroupMode = () => {
    setIsGroupMode(!isGroupMode);
    if (!isGroupMode) {
      // 进入组会话模式时隐藏搜索栏
      setIsSearching(false);
      searchBarRef.current?.clearInput();
    }
  };

  useHotKey();

  return (
    <div
      className={`${styles.sidebar} ${props.className}`}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen ? "none" : undefined,
      }}
    >
      <div
        className={
          styles["sidebar-search-bar"] +
          " " +
          (isSearching ? styles["sidebar-search-bar-isSearching"] : "")
        }
        style={{ display: isGroupMode ? "none" : "block" }}
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
          {isGroupMode ? (
            <div className={styles["group-chat-list"]}>
              {/* 组会话列表 - 暂时用空列表替代 */}
              <div className={styles["empty-group-list"]}>
                <p>组会话功能开发中...</p>
              </div>
            </div>
          ) : (
            <ChatList />
          )}
        </div>
      )}

      <div className={styles["sidebar-tail"]}>
        <div className={styles["sidebar-actions"]}>
          <div className={styles["sidebar-action"]}>
            <IconButton
              icon={<SettingsIcon />}
              className={
                location.pathname.includes(Path.Settings)
                  ? buttonStyles["active"]
                  : ""
              }
              onClick={() => {
                if (location.pathname.includes(Path.Settings)) {
                  navigate(Path.Chat);
                } else {
                  navigate(Path.Settings);
                }
              }}
            />
          </div>

          <div className={styles["sidebar-action"]}>
            {!isMobileScreen && (
              <IconButton
                icon={<GroupIcon />}
                onClick={toggleGroupMode}
                title="组会话"
                className={isGroupMode ? buttonStyles["active"] : ""}
              />
            )}
          </div>
        </div>

        <div>
          <IconButton
            icon={<AddIcon />}
            onClick={async () => {
              if (isGroupMode) {
                const newGroup = createEmptyGroup();
                chatStore.newGroup(newGroup);
                // TODO: 考虑是否需要选择新创建的组。
                // 因为 newGroup 方法会将新组放在 groups 数组的第一个，并设置 currentGroupIndex 为 0，
                // 所以我们只需要导航到聊天页面即可。
                navigate(Path.Chat);
              } else {
                await chatStore.newSession();
                navigate(Path.Chat);
              }
              stopSearch();
            }}
            title={isGroupMode ? "新建组会话" : "新建会话"}
          />
        </div>
      </div>
    </div>
  );
}
