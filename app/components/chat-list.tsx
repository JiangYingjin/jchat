import chatItemStyles from "../styles/chat-item.module.scss";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";

import { useChatStore } from "../store";
import Locale from "../locales";
import { usePathname, useRouter } from "next/navigation";
import { Path } from "../constant";
import { useRef, useMemo, memo, useState, useEffect, useCallback } from "react";
import { useMobileScreen } from "../utils";
import { useAppReadyGuard } from "../hooks/app-ready";
import { useContextMenu } from "./context-menu";
import { showToast } from "./ui-lib";
import { SessionContextMenu } from "./session-context-menu";

/**
 * 根据消息数量计算项目样式
 * @param messageCount - 对话中的消息数量
 * @returns 动态样式对象
 */
function getChatItemStyle(messageCount: number) {
  // 渐变起止色
  const startBg = [255, 255, 255]; // #FFFFFF
  let endBg;
  /**
   系列	颜色名称	颜色预览	RGB值	核心特质
   薰衣草系	原始版	!#e1dceb	rgb(225, 220, 235)	优雅、平衡的基准选择。
   薰衣草系	月光蓝紫	!#e4e2ee	rgb(228, 226, 238)	最柔和，与背景融合度最高。
   薰衣草系	暮云灰紫	!#dad7e4	rgb(218, 215, 228)	最沉稳，带有高级灰质感。
   青玉系	晨雾青	!#dcebe6	rgb(220, 235, 230)	最清新，引入自然空气感。
   青玉系	湖心玉	!#d4e4e0	rgb(212, 228, 224)	温润而清晰，经典的蓝绿搭配。
   紫晶系	鸢尾紫	!#d7d2e6	rgb(215, 210, 230)	更醒目，但依然优雅。
   紫晶系	星尘蓝	!#cdd4e8	rgb(205, 212, 232)	关联性最强，与主色同源。
   */
  endBg = [205, 212, 232]; // 星尘蓝（同源蓝色）
  endBg = [225, 220, 235]; // 原始版
  endBg = [212, 228, 224]; // 湖心玉（绿色）
  endBg = [215, 210, 230]; // 鸢尾紫（紫色）
  endBg = [218, 215, 228]; // 暮云灰紫（灰色）
  endBg = [220, 235, 230]; // 晨雾青（青色）
  endBg = [228, 226, 238]; // 月光蓝紫（蓝色）

  const minCount = 3;
  const maxCount = 15;
  // 更优雅的写法，使用 Math.clamp（如果没有则用 Math.min/Math.max 组合）
  let t = (messageCount - minCount) / (maxCount - minCount);
  t = Math.max(0, Math.min(1, t));
  t = 1 - Math.pow(1 - t, 1.25);
  const interpolate = (start: number, end: number, factor: number) =>
    Math.round(start + (end - start) * factor);
  const currentBg = [
    interpolate(startBg[0], endBg[0], t),
    interpolate(startBg[1], endBg[1], t),
    interpolate(startBg[2], endBg[2], t),
  ];
  return {
    "--dynamic-bg": `rgb(${currentBg.join(", ")})`,
  } as React.CSSProperties;
}

// StatusDot 组件
interface StatusDotProps {
  status: "normal" | "error" | "pending";
  title?: string; // 可选的提示文本
}

function StatusDot({ status, title }: StatusDotProps) {
  if (status === "normal") {
    return null;
  }

  let className = chatItemStyles["chat-item-status-dot"];
  let defaultTitle = "";

  if (status === "pending") {
    className += " " + chatItemStyles["chat-item-status-dot-yellow"];
    defaultTitle = "用户消息待回复";
  } else if (status === "error") {
    className += " " + chatItemStyles["chat-item-status-dot-red"];
    defaultTitle = "会话出现错误";
  }

  return <span className={className} title={title || defaultTitle} />;
}

// 统一的聊天项目组件
export function ChatItem(props: {
  onClick?: (e?: React.MouseEvent) => void;
  onDelete?: () => void;
  title: string;
  count: number;
  selected: boolean;
  selectedForMerge?: boolean; // 是否被选入待合并列表
  id: string;
  index: number;
  status: "normal" | "error" | "pending";
  showIndex?: boolean; // 是否显示序号前缀
  totalCount?: number; // 总数量，用于计算对齐
  prefixType?: "index" | "count" | "none"; // 前缀类型：序号、数量、无前缀
  prefixValue?: number; // 前缀值（当 prefixType 为 count 时使用）
  styleCalculator?: (count: number) => React.CSSProperties; // 背景色计算函数
  tooltipText?: string; // 自定义提示文本
  enableContextMenu?: boolean; // 是否启用右键菜单
}) {
  const currentPath = usePathname();
  const router = useRouter();
  const chatStore = useChatStore();

  // 内联编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(props.title);
  const editInputRef = useRef<HTMLInputElement>(null);

  // 右键菜单（仅在启用时使用）
  const menu = useContextMenu();
  const enableContextMenu = props.enableContextMenu ?? false;

  // 当标题变化时，更新编辑状态中的标题
  useEffect(() => {
    if (!isEditing) {
      setEditTitle(props.title);
    }
  }, [props.title, isEditing]);

  // 进入编辑模式时聚焦输入框
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  // 使用传入的样式计算函数，默认为普通会话样式
  const styleCalculator = props.styleCalculator || getChatItemStyle;
  const dynamicStyle = useMemo(
    () => styleCalculator(props.count),
    [styleCalculator, props.count],
  );

  // 使用 @dnd-kit 的 useSortable hook
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    ...dynamicStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 选中状态加粗字体
  const isActive =
    props.selected && (currentPath === Path.Chat || currentPath === Path.Home);

  // 处理点击事件（考虑右键菜单状态和编辑模式）
  const handleClick = (e: React.MouseEvent) => {
    if (isEditing) {
      return; // 编辑模式下不响应点击
    }
    if (enableContextMenu && menu.isOpen) {
      menu.close();
      return;
    }
    props.onClick?.(e);
  };

  // 保存标题
  const handleSaveTitle = async () => {
    const session = chatStore.getSessionById(props.id);
    if (!session) {
      showToast("会话不存在");
      setIsEditing(false);
      return;
    }

    const newTitle = editTitle.trim();
    if (!newTitle) {
      showToast("标题不能为空");
      setEditTitle(props.title); // 恢复原标题
      setIsEditing(false);
      return;
    }

    // 如果标题没有变化，直接退出编辑模式
    if (newTitle === props.title) {
      setIsEditing(false);
      return;
    }

    // 判断是否为组内会话
    const isGroupSession = session.groupId !== null;

    // 更新标题
    if (isGroupSession) {
      chatStore.updateGroupSession(
        session,
        (s) => {
          s.title = newTitle;
        },
        true, // 手动编辑，设置 isTitleManuallyEdited = true
      );
    } else {
      chatStore.updateSession(
        session,
        (s) => {
          s.title = newTitle;
        },
        true, // 手动编辑，设置 isTitleManuallyEdited = true
      );
    }

    // 异步保存和广播
    (async () => {
      try {
        await chatStore.saveSessionMessages(session);
        // 等待存储写入完成
        await new Promise((resolve) => setTimeout(resolve, 100));
        // 发送广播通知其他标签页
        if (
          typeof window !== "undefined" &&
          (window as any).__jchat_broadcast_channel
        ) {
          const message = {
            type: "STATE_UPDATE_AVAILABLE",
            payload: {
              lastUpdate: Date.now(),
              changeType: "sessionUpdate",
              sessionId: session.id,
            },
          };
          (window as any).__jchat_broadcast_channel.postMessage(message);
        }
      } catch (error) {
        console.error("保存会话标题失败:", error);
      }
    })();

    setIsEditing(false);
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditTitle(props.title);
    setIsEditing(false);
  };

  // 处理输入框失去焦点
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // 延迟处理，以便点击保存按钮时不会立即触发
    setTimeout(() => {
      // 检查焦点是否还在输入框或相关元素上
      const activeElement = document.activeElement;
      if (activeElement !== editInputRef.current) {
        handleSaveTitle();
      }
    }, 200);
  };

  // 渲染前缀
  const renderPrefix = () => {
    if (props.prefixType === "index" && props.showIndex) {
      return (
        <span
          className={chatItemStyles["chat-item-index-prefix"]}
          style={{
            minWidth: `${Math.max(16, Math.floor(Math.log10(props.totalCount || 1) + 1) * 6)}px`,
          }}
        >
          {props.index + 1}
        </span>
      );
    } else if (
      props.prefixType === "count" &&
      props.prefixValue !== undefined
    ) {
      return (
        <span
          className={chatItemStyles["group-item-count-prefix"]}
          style={{
            minWidth: `${Math.max(16, Math.floor(Math.log10(props.prefixValue || 1) + 1) * 6)}px`,
          }}
        >
          {props.prefixValue}
        </span>
      );
    }
    return null;
  };

  // 生成提示文本
  const getTooltipText = () => {
    if (props.tooltipText) {
      return props.tooltipText;
    }
    if (props.prefixType === "count") {
      return `${props.title}\n组内会话数: ${props.prefixValue}`;
    }
    return `${props.title}\n${Locale.ChatItem.ChatItemCount(props.count)}`;
  };

  return (
    <div
      ref={setNodeRef}
      className={
        chatItemStyles["chat-item"] +
        (isActive ? " " + chatItemStyles["chat-item-selected"] : "") +
        (props.selectedForMerge ? " " + chatItemStyles["chat-item-merge"] : "")
      }
      onClick={handleClick}
      onContextMenu={enableContextMenu ? menu.openAtEvent : undefined}
      style={style}
      title={getTooltipText()}
      {...attributes}
      {...listeners}
    >
      <div className={chatItemStyles["chat-item-title"]}>
        {renderPrefix()}
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                handleSaveTitle();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                handleCancelEdit();
              }
            }}
            onBlur={handleBlur}
            onClick={(e) => e.stopPropagation()}
            className={chatItemStyles["chat-item-title-input"]}
          />
        ) : (
          <span>{props.title}</span>
        )}
      </div>
      <StatusDot status={props.status} />

      {/* 右键菜单（仅在启用时渲染） */}
      {enableContextMenu && (
        <SessionContextMenu
          sessionId={props.id}
          showMoveToTop={true}
          sessionIndex={props.index}
          enableInlineEdit={true}
          onUpdateTitle={() => setIsEditing(true)}
          menu={menu}
        />
      )}
    </div>
  );
}

// 加载更多提示组件
function LoadMoreIndicator({
  isLoading,
  hasMore,
}: {
  isLoading: boolean;
  hasMore: boolean;
}) {
  if (!hasMore) {
    return null;
  }

  return (
    <div
      className="flex items-center justify-center py-4"
      style={{ minHeight: "40px" }}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
          <span>加载中...</span>
        </div>
      ) : (
        <div className="text-gray-400 text-xs">滚动加载更多</div>
      )}
    </div>
  );
}

// 创建一个只订阅会话列表的组件，用于跨标签页同步
const ChatListSessions = memo(function ChatListSessions({
  sessions,
  selectedIndex,
  selectSession,
  moveSession,
  sessionPagination,
  mergeOrderSessionIds,
  toggleMergeSelection,
  exitMergeMode,
}: {
  sessions: any[];
  selectedIndex: number;
  selectSession: (index: number) => void;
  moveSession: (from: number, to: number) => void;
  sessionPagination: {
    loadedCount: number;
    isLoading: boolean;
    hasMore: boolean;
  };
  mergeOrderSessionIds: string[];
  toggleMergeSelection: (sessionId: string) => void;
  exitMergeMode: () => void;
}) {
  const chatStore = useChatStore();
  const router = useRouter();
  const isMobileScreen = useMobileScreen();
  const isAppReady = useAppReadyGuard();

  // 计算可见的会话（只包含已加载的）
  const visibleSessions = useMemo(() => {
    return sessions.slice(0, sessionPagination.loadedCount);
  }, [sessions, sessionPagination.loadedCount]);

  // 使用 useMemo 优化渲染
  const memoizedSessions = useMemo(() => visibleSessions, [visibleSessions]);
  const memoizedSelectedIndex = useMemo(() => selectedIndex, [selectedIndex]);

  // 🔥 所有 hooks 必须在条件渲染之前调用
  // 配置传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 鼠标需要移动至少8像素才激活拖拽
        // delay: 250, // 或者按下250ms后才激活拖拽
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 🔥 确保应用完全准备好后再渲染聊天列表
  if (!isAppReady) {
    return (
      <div className={chatItemStyles["chat-list"]}>
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-xs text-gray-600">加载会话...</p>
          </div>
        </div>
      </div>
    );
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = memoizedSessions.findIndex(
        (session) => session.id === active.id,
      );
      const newIndex = memoizedSessions.findIndex(
        (session) => session.id === over?.id,
      );

      if (oldIndex !== -1 && newIndex !== -1) {
        moveSession(oldIndex, newIndex);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext
        items={memoizedSessions.map((session) => session.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={chatItemStyles["chat-list"]}>
          {memoizedSessions.map((item, i) => (
            <ChatItem
              title={item.title}
              count={item.messageCount}
              key={item.id}
              id={item.id}
              index={i}
              selected={i === memoizedSelectedIndex}
              selectedForMerge={mergeOrderSessionIds.includes(item.id)}
              onClick={async (e?: React.MouseEvent) => {
                if (e && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMergeSelection(item.id);
                  return;
                }
                exitMergeMode();
                await selectSession(i);
                // 移动端：选择会话后切换到聊天界面
                if (isMobileScreen) {
                  chatStore.showChatOnMobile();
                } else {
                  // 桌面端：导航到首页
                  router.push(Path.Home);
                }
              }}
              onDelete={async () => {
                await chatStore.deleteSession(i);
              }}
              status={item.status}
              prefixType="none"
              enableContextMenu={true}
            />
          ))}
          <LoadMoreIndicator
            isLoading={sessionPagination.isLoading}
            hasMore={sessionPagination.hasMore}
          />
        </div>
      </SortableContext>
    </DndContext>
  );
});

// 主要的 ChatList 组件，使用细粒度订阅
export function ChatList(props: {}) {
  // 使用细粒度订阅，分别订阅不同的状态
  const sessions = useChatStore((state) => state.sessions);
  const selectedIndex = useChatStore((state) => state.currentSessionIndex);
  const selectSession = useChatStore((state) => state.selectSession);
  const moveSession = useChatStore((state) => state.moveSession);
  const sessionPagination = useChatStore((state) => state.sessionPagination);
  const ensureSessionLoaded = useChatStore(
    (state) => state.ensureSessionLoaded,
  );
  const mergeOrderSessionIds = useChatStore(
    (state) => state.mergeOrderSessionIds,
  );
  const toggleMergeSelection = useChatStore(
    (state) => state.toggleMergeSelection,
  );
  const exitMergeMode = useChatStore((state) => state.exitMergeMode);

  // 当选中会话变化时，确保该会话已加载
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < sessions.length) {
      ensureSessionLoaded(selectedIndex);
    }
  }, [selectedIndex, sessions.length, ensureSessionLoaded]);

  // 当会话列表变化时，更新分页状态
  useEffect(() => {
    const { loadedCount, hasMore } = sessionPagination;
    const totalCount = sessions.length;

    // 如果已加载数量超过总数量，需要调整
    if (loadedCount > totalCount) {
      const chatStore = useChatStore.getState();
      chatStore.setSessionPagination({
        loadedCount: Math.min(loadedCount, totalCount),
        hasMore: false,
      });
    } else if (loadedCount < totalCount && !hasMore) {
      // 如果还有更多会话但 hasMore 为 false，需要更新
      const chatStore = useChatStore.getState();
      chatStore.setSessionPagination({
        hasMore: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessions.length,
    sessionPagination.loadedCount,
    sessionPagination.hasMore,
  ]);

  // 使用 React.memo 优化，只在必要的时候重新渲染
  return (
    <ChatListSessions
      sessions={sessions}
      selectedIndex={selectedIndex}
      selectSession={selectSession}
      moveSession={moveSession}
      sessionPagination={sessionPagination}
      mergeOrderSessionIds={mergeOrderSessionIds}
      toggleMergeSelection={toggleMergeSelection}
      exitMergeMode={exitMergeMode}
    />
  );
}
