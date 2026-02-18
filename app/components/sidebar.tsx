import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import sidebarStyles from "../styles/sidebar.module.scss";
import buttonStyles from "../styles/button.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import AddIcon from "../icons/add.svg";
import GroupIcon from "../icons/group.svg";
import PinIcon from "../icons/pin.svg";
import Locale from "../locales";

import { useChatStore } from "../store";
import { useAppReadyGuard } from "../hooks/app-ready";

import {
  DEFAULT_SIDEBAR_WIDTH,
  Path,
  SESSION_LOAD_MORE_THRESHOLD,
} from "../constant";

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
  const chatListSessionsFilter = useChatStore(
    (state) => state.chatListSessionsFilter,
  );
  const chatListGroupView = useChatStore((state) => state.chatListGroupView);
  const groups = useChatStore((state) => state.groups);
  const currentGroupIndex = useChatStore((state) => state.currentGroupIndex);

  // --- 计算滚动 key ---
  const scrollKey = useMemo(() => {
    if (chatListView === "sessions") {
      return chatListSessionsFilter === "favorited"
        ? "sessions-favorited"
        : "sessions";
    }
    if (chatListView === "groups") {
      if (chatListGroupView === "groups") return "groups";
      const group = groups[currentGroupIndex];
      return group ? `group-sessions:${group.id}` : "group-sessions:unknown";
    }
    return "sessions";
  }, [
    chatListView,
    chatListSessionsFilter,
    chatListGroupView,
    groups,
    currentGroupIndex,
  ]);

  // 使用 ref 存储最新的 scrollKey，避免闭包问题
  const scrollKeyRef = useRef(scrollKey);
  // 存储防抖定时器，用于在视图切换时取消
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const prevKey = scrollKeyRef.current;
    const el = sidebarScrollRef.current;

    // 如果 scrollKey 改变了，说明视图切换了
    if (prevKey !== scrollKey && prevKey && el) {
      // 取消待执行的防抖保存
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // 立即保存上一个视图的滚动位置
      const currentScrollTop = el.scrollTop;
      if (currentScrollTop >= 0 && !isNaN(currentScrollTop)) {
        chatStore.saveSidebarScrollPosition(prevKey, currentScrollTop);
      }
    }

    scrollKeyRef.current = scrollKey;
  }, [scrollKey, chatStore]);

  // --- 简易防抖 ---
  const useDebounced = (fn: (v: number) => void, delay: number) => {
    return useCallback(
      (v: number) => {
        if (debounceTimerRef.current) {
          window.clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(() => {
          fn(v);
          debounceTimerRef.current = null;
        }, delay);
      },
      [fn, delay],
    );
  };

  const debouncedSave = useDebounced((scrollTop: number) => {
    // 使用 ref 中的最新 scrollKey，避免闭包问题
    const currentScrollKey = scrollKeyRef.current;
    chatStore.saveSidebarScrollPosition(currentScrollKey, scrollTop);
  }, 120);

  // --- 分页加载相关 ---
  const sessionPagination = useChatStore((state) => state.sessionPagination);
  const loadMoreSessions = useChatStore((state) => state.loadMoreSessions);
  const resetSessionPagination = useChatStore(
    (state) => state.resetSessionPagination,
  );

  // --- 滚动保存和加载更多 ---
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

      // 保存滚动位置
      if (
        typeof scrollTop === "number" &&
        scrollTop >= 0 &&
        !isNaN(scrollTop)
      ) {
        debouncedSave(scrollTop);
      }

      // 检测是否需要加载更多（仅在会话列表模式下）
      if (chatListView === "sessions") {
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;

        // 当距离底部小于阈值时，加载更多
        if (
          distanceToBottom < SESSION_LOAD_MORE_THRESHOLD &&
          sessionPagination.hasMore &&
          !sessionPagination.isLoading
        ) {
          loadMoreSessions();
        }
      }
    },
    [
      debouncedSave,
      chatListView,
      sessionPagination.hasMore,
      sessionPagination.isLoading,
      loadMoreSessions,
    ],
  );

  // --- 滚动恢复 ---
  useEffect(() => {
    const el = sidebarScrollRef.current;
    if (!el) return;

    // 读取保存的滚动位置
    const saved = chatStore.getSidebarScrollPosition(scrollKey);
    const currentScrollTop = el.scrollTop;

    // 允许恢复 0 值（0 是有效的顶部位置）
    // 只有当 saved 是 undefined、null 或无效值时才跳过
    if (saved !== undefined && saved !== null && !isNaN(saved) && saved >= 0) {
      // 如果当前滚动位置和保存的位置相同，不需要恢复
      if (Math.abs(currentScrollTop - saved) < 1) {
        return;
      }

      // 等待布局稳定后再恢复
      const raf = requestAnimationFrame(() => {
        try {
          el.scrollTop = saved;
        } catch (error) {
          console.error("[Sidebar] 恢复滚动位置失败:", error);
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [scrollKey, chatListView, chatListGroupView, chatStore]);

  // 当会话列表视图或筛选切换时，重置分页状态（必须在条件渲染之前）
  useEffect(() => {
    if (chatListView === "sessions") {
      resetSessionPagination();
    }
  }, [chatListView, chatListSessionsFilter, resetSessionPagination]);

  // 获取当前列表模式 (已在上面声明)

  const stopSearch = useCallback(() => {
    setIsSearching(false);
    searchBarRef.current?.clearInput();
  }, []);

  const handleNewButtonClick = useCallback(async () => {
    try {
      if (chatListView === "sessions") {
        await chatStore.newSession();
      } else if (chatStore.chatListGroupView === "groups") {
        const newGroup = createEmptyGroup();
        await chatStore.newGroup(newGroup);
      } else {
        await chatStore.newGroupSession();
      }
      if (isMobileScreen) {
        chatStore.showChatOnMobile();
      } else {
        if (!pathname.includes(Path.Home) && !pathname.includes(Path.Chat)) {
          router.push(Path.Home);
        }
      }
      stopSearch();
    } catch (error) {
      console.error("[Sidebar] 新建按钮点击出错:", error);
    }
  }, [chatListView, chatStore, isMobileScreen, pathname, router, stopSearch]);

  // Ctrl+N / Cmd+N：等同于点击「新建会话/新建组/新建组内会话」按钮
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        handleNewButtonClick();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewButtonClick]);

  // Ctrl+Shift+F：定位到搜索框并全选（不进入“搜索展开”状态，避免隐藏会话列表）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        if (chatListView !== "sessions") {
          chatStore.setchatListView("sessions");
        }
        // 不调用 setIsSearching(true)，否则 sidebar-body 会被隐藏
        setTimeout(() => {
          searchBarRef.current?.focusAndSelectAll?.();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatListView, chatStore]);

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

  const toggleGroupMode = () => {
    if (chatListView === "sessions") {
      // 从普通会话模式切换到组模式
      chatStore.setchatListView("groups");
      setIsSearching(false);
      searchBarRef.current?.clearInput();
    } else {
      // 从组模式切换回普通会话模式
      chatStore.setchatListView("sessions");
      resetSessionPagination();
    }
  };

  // 已收藏会话：在「全部普通会话」与「已收藏」子集间切换；若当前在组视图则先切到会话视图并显示已收藏
  const toggleFavoritedView = () => {
    if (chatListView === "groups") {
      chatStore.setchatListView("sessions");
      chatStore.setChatListSessionsFilter("favorited");
      setIsSearching(false);
      searchBarRef.current?.clearInput();
    } else {
      chatStore.setChatListSessionsFilter(
        chatListSessionsFilter === "favorited" ? "all" : "favorited",
      );
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
                icon={<PinIcon />}
                onClick={toggleFavoritedView}
                title={Locale.Chat.Actions.FavoritedSessionsList}
                className={
                  chatListView === "sessions" &&
                  chatListSessionsFilter === "favorited"
                    ? buttonStyles["active"]
                    : ""
                }
              />
            )}
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
          <div className={sidebarStyles["sidebar-action"]}>
            <IconButton
              icon={<AddIcon />}
              onClick={handleNewButtonClick}
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
    </div>
  );
}
