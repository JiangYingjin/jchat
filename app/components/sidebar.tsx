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

const GroupList = dynamic(
  async () => (await import("./group-list")).GroupList,
  {
    loading: () => null,
  },
);

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

  // 获取当前列表模式
  const chatListView = useChatStore((state) => state.chatListView);

  const stopSearch = () => {
    setIsSearching(false);
    searchBarRef.current?.clearInput();
  };

  const toggleGroupMode = () => {
    if (chatListView === "sessions") {
      // 从普通会话模式切换到组模式
      chatStore.setchatListView("groups");
      setIsSearching(false);
      searchBarRef.current?.clearInput();
    } else {
      // 从组模式切换回普通会话模式
      chatStore.setchatListView("sessions");
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
        style={{ display: chatListView !== "sessions" ? "none" : "block" }}
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
          {chatListView === "sessions" ? <ChatList /> : <GroupList />}
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
                className={
                  chatListView !== "sessions" ? buttonStyles["active"] : ""
                }
              />
            )}
          </div>
        </div>

        <div>
          <IconButton
            icon={<AddIcon />}
            onClick={async () => {
              if (chatListView === "sessions") {
                // 普通会话模式：新建会话
                await chatStore.newSession();
                navigate(Path.Chat);
              } else if (chatListView === "groups") {
                // 组列表模式：新建组
                const newGroup = createEmptyGroup();
                await chatStore.newGroup(newGroup);
                navigate(Path.Chat);
              } else if (chatListView === "group-sessions") {
                // 组内会话模式：新建组内会话
                await chatStore.newGroupSession();
                navigate(Path.Chat);
              }
              stopSearch();
            }}
            title={
              chatListView === "sessions"
                ? "新建会话"
                : chatListView === "groups"
                  ? "新建组"
                  : "新建组内会话"
            }
          />
        </div>
      </div>
    </div>
  );
}
