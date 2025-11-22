import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import sidebarStyles from "../styles/sidebar.module.scss";
import buttonStyles from "../styles/button.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import AddIcon from "../icons/add.svg";
import GroupIcon from "../icons/group.svg";

import { useChatStore } from "../store";
import { useAppReadyGuard } from "../hooks/app-ready";

import { DEFAULT_SIDEBAR_WIDTH, Path } from "../constant";

import { useRouter, usePathname } from "next/navigation";
import { useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { SearchBar, SearchInputRef } from "./search-bar";
import { createEmptyGroup } from "../utils/group";
import { GroupSessionsHeader } from "./group-list";

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});

const GroupList = dynamic(
  async () => (await import("./group-list")).GroupList,
  {
    loading: () => null,
  },
);

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
  const isAppReady = useAppReadyGuard();

  // sidebar
  useSideBar();
  const router = useRouter();
  const isMobileScreen = useMobileScreen();
  const pathname = usePathname();

  // search bar
  const searchBarRef = useRef<SearchInputRef>(null);
  const [isSearching, setIsSearching] = useState(false);

  // --- 滚动容器 ref ---
  const sidebarScrollRef = useRef<HTMLDivElement>(null);

  // --- 读取用于计算 key 的状态 ---
  const chatListView = useChatStore((state) => state.chatListView);
  const chatListGroupView = useChatStore((state) => state.chatListGroupView);
  const groups = useChatStore((state) => state.groups);
  const currentGroupIndex = useChatStore((state) => state.currentGroupIndex);

  // --- 计算滚动 key ---
  const scrollKey = useMemo(() => {
    if (chatListView === "sessions") return "sessions";
    if (chatListView === "groups") {
      if (chatListGroupView === "groups") return "groups";
      const group = groups[currentGroupIndex];
      if (group) return `group-sessions:${group.id}`;
      return "group-sessions:unknown";
    }
    return "sessions";
  }, [chatListView, chatListGroupView, groups, currentGroupIndex]);

  // --- 简易防抖 ---
  const useDebounced = (fn: (v: number) => void, delay: number) => {
    const timerRef = useRef<number | null>(null);
    return useCallback(
      (v: number) => {
        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          fn(v);
        }, delay);
      },
      [fn, delay],
    );
  };

  const debouncedSave = useDebounced((scrollTop: number) => {
    // 只使用按 key 保存的方式，确保不同视图（sessions、groups、group-sessions）的滚动位置独立保存
    chatStore.saveSidebarScrollPosition(scrollKey, scrollTop);
  }, 120);

  // --- 滚动保存 ---
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const scrollTop = e.currentTarget.scrollTop;
      if (
        typeof scrollTop === "number" &&
        scrollTop >= 0 &&
        !isNaN(scrollTop)
      ) {
        debouncedSave(scrollTop);
      }
    },
    [debouncedSave],
  );

  // --- 滚动恢复 ---
  useEffect(() => {
    const el = sidebarScrollRef.current;
    if (!el) return;

    // 读取保存的滚动位置
    const saved = chatStore.getSidebarScrollPosition(scrollKey);
    if (saved && saved > 0) {
      // 等待布局稳定后再恢复
      const raf = requestAnimationFrame(() => {
        try {
          el.scrollTop = saved;
        } catch {}
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [scrollKey, chatListView, chatListGroupView, chatStore]);

  // 获取当前列表模式 (已在上面声明)

  // 🔥 确保应用完全准备好后再渲染侧边栏
  if (!isAppReady) {
    return (
      <div className={props.className}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-sm text-gray-600">加载中...</p>
          </div>
        </div>
      </div>
    );
  }

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

  return (
    <div
      className={`${sidebarStyles.sidebar} ${props.className}`}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen ? "none" : undefined,
      }}
    >
      <div
        className={
          sidebarStyles["sidebar-search-bar"] +
          " " +
          (isSearching ? sidebarStyles["sidebar-search-bar-isSearching"] : "")
        }
        style={{ display: chatListView !== "sessions" ? "none" : "block" }}
      >
        <SearchBar ref={searchBarRef} setIsSearching={setIsSearching} />
      </div>

      {/* Group Sessions Header - 只在 groups 模式下显示 */}
      {chatListView === "groups" && (
        <div className={sidebarStyles["group-sessions-header-container"]}>
          <GroupSessionsHeader />
        </div>
      )}

      {!isSearching && (
        <div
          ref={sidebarScrollRef}
          className={sidebarStyles["sidebar-body"]}
          onScroll={handleScroll}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              router.push(Path.Home);
            }
          }}
        >
          {chatListView === "sessions" ? <ChatList /> : <GroupList />}
        </div>
      )}

      <div className={sidebarStyles["sidebar-tail"]}>
        <div className={sidebarStyles["sidebar-actions"]}>
          <div className={sidebarStyles["sidebar-action"]}>
            <IconButton
              icon={<SettingsIcon />}
              className={
                pathname.includes(Path.Settings) ? buttonStyles["active"] : ""
              }
              onClick={() => {
                if (pathname.includes(Path.Settings)) {
                  // 如果当前在设置页面，返回首页
                  if (isMobileScreen) {
                    chatStore.showChatOnMobile();
                  } else {
                    router.push(Path.Home);
                  }
                } else {
                  // 如果当前不在设置页面，跳转到设置页面
                  if (isMobileScreen) {
                    chatStore.showSettingsOnMobile();
                    router.push(Path.Settings);
                  } else {
                    router.push(Path.Settings);
                  }
                }
              }}
            />
          </div>

          <div className={sidebarStyles["sidebar-action"]}>
            {!isMobileScreen && (
              <IconButton
                icon={<GroupIcon />}
                onClick={() => {
                  toggleGroupMode();
                }}
                title="组会话"
                className={
                  chatListView === "groups" ? buttonStyles["active"] : ""
                }
              />
            )}
          </div>
        </div>

        <div>
          <IconButton
            icon={<AddIcon />}
            onClick={async () => {
              try {
                // 判断当前模式并执行相应操作
                if (chatListView === "sessions") {
                  await chatStore.newSession();
                } else if (chatStore.chatListGroupView === "groups") {
                  const newGroup = createEmptyGroup();
                  await chatStore.newGroup(newGroup);
                } else {
                  await chatStore.newGroupSession();
                }

                // 移动端：新建会话后切换到聊天界面
                if (isMobileScreen) {
                  chatStore.showChatOnMobile();
                } else {
                  // 桌面端：新建会话后导航到首页
                  if (
                    !pathname.includes(Path.Home) &&
                    !pathname.includes(Path.Chat)
                  ) {
                    router.push(Path.Home);
                  }
                }

                stopSearch();
              } catch (error) {
                console.error("[Sidebar] 新建按钮点击出错:", error);
              }
            }}
            title={
              chatListView === "sessions"
                ? "新建会话"
                : chatStore.chatListGroupView === "groups"
                  ? "新建组"
                  : "新建组内会话"
            }
          />
        </div>
      </div>
    </div>
  );
}
