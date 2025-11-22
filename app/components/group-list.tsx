import { useRef, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useChatStore, ChatGroup } from "../store";
import { Path } from "../constant";
import { useMobileScreen } from "../utils";
import { ChatItem } from "./chat-list";
import { useAppReadyGuard } from "../hooks/app-ready";
import chatItemStyles from "../styles/chat-item.module.scss";
import groupSessionsStyles from "../styles/group-sessions.module.scss";
import BackIcon from "../icons/left.svg";
import Locale from "../locales";
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";

/**
 * 根据消息数量计算组项目样式（maxCount 为 10）
 * @param messageCount - 对话中的消息数量
 * @returns 动态样式对象
 */
function getGroupChatItemStyle(messageCount: number) {
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
  endBg = [220, 235, 230];
  endBg = [228, 226, 238]; // 月光蓝紫（蓝色）

  const minCount = 3;
  const maxCount = 10; // 组会话使用较小的 maxCount
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

// StatusDot 组件（从 chat-list.tsx 复制）
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

// 独立的 GroupSessionsHeader 组件
export function GroupSessionsHeader() {
  const [groups, currentGroupIndex, chatListGroupView, chatStore] =
    useChatStore((state) => [
      state.groups,
      state.currentGroupIndex,
      state.chatListGroupView,
      state,
    ]);

  // 返回到组列表
  const handleBackToGroups = () => {
    chatStore.setchatListGroupView("groups");
  };

  const currentGroup = groups[currentGroupIndex];
  const groupSessions = currentGroup
    ? currentGroup.sessionIds
        .map((sessionId: string) => chatStore.groupSessions[sessionId])
        .filter(Boolean)
    : [];

  return (
    <div className={groupSessionsStyles["group-sessions-header"]}>
      {chatListGroupView === "groups" ? (
        // 在 groups view 中显示 header，但返回按钮不可用
        <>
          <div
            className={
              groupSessionsStyles["back-button"] +
              " " +
              groupSessionsStyles["back-button-disabled"]
            }
          >
            <BackIcon />
          </div>
          <span className={groupSessionsStyles["group-sessions-title"]}>
            组会话模式
          </span>
        </>
      ) : (
        // 在 group-sessions view 中显示可用的返回按钮
        <>
          <div
            className={groupSessionsStyles["back-button"]}
            onClick={handleBackToGroups}
            title="返回组列表"
          >
            <BackIcon />
          </div>
          <span className={groupSessionsStyles["group-sessions-title"]}>
            组内会话 ({groupSessions.length})
          </span>
        </>
      )}
    </div>
  );
}

// 组会话列表组件
export function GroupList() {
  const [
    groups,
    currentGroupIndex,
    chatListView,
    chatListGroupView,
    chatStore,
  ] = useChatStore((state) => [
    state.groups,
    state.currentGroupIndex,
    state.chatListView,
    state.chatListGroupView,
    state,
  ]);
  const router = useRouter();
  const isMobileScreen = useMobileScreen();
  const isAppReady = useAppReadyGuard();

  // 🔥 所有 hooks 必须在条件渲染之前调用
  // 配置传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 鼠标需要移动至少8像素才激活拖拽
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 🔥 确保应用完全准备好后再渲染组列表
  if (!isAppReady) {
    return (
      <div className={chatItemStyles["chat-list"]}>
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mx-auto mb-2"></div>
            <p className="text-xs text-gray-600">加载组列表...</p>
          </div>
        </div>
      </div>
    );
  }

  // 处理组的点击 - 根据是否已选中决定行为
  const handleGroupClick = (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group || group.sessionIds.length === 0) return;

    // 判断是否是第一次点击该组（当前组索引不是这个组）
    if (currentGroupIndex !== groupIndex) {
      // 第一次点击：切换到该组，使用该组保存的 currentSessionIndex
      chatStore.selectGroup(groupIndex);

      // 获取目标组保存的 currentSessionIndex，如果无效则使用 0
      const savedIndex = group.currentSessionIndex;
      const validIndex =
        savedIndex >= 0 && savedIndex < group.sessionIds.length
          ? savedIndex
          : 0;

      chatStore.selectGroupSession(validIndex, false);
      // 移动端：选择组后切换到聊天界面
      if (isMobileScreen) {
        chatStore.showChatOnMobile();
      } else {
        // 桌面端：导航到首页
        router.push(Path.Home);
      }
    } else {
      // 第二次点击：切换到组内会话视图
      chatStore.setchatListGroupView("group-sessions");
    }
  };

  // 返回到组列表
  const handleBackToGroups = () => {
    chatStore.setchatListGroupView("groups");
  };

  // 处理组内会话的点击
  const handleGroupSessionClick = (sessionIndex: number) => {
    // 选择该会话，保持在当前组内会话视图
    chatStore.selectGroupSession(sessionIndex, false);
    // 移动端：选择会话后切换到聊天界面
    if (isMobileScreen) {
      chatStore.showChatOnMobile();
    } else {
      // 桌面端：导航到首页
      router.push(Path.Home);
    }
  };

  // 拖拽处理
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = groups.findIndex(
        (group) => `group-${group.id}` === active.id,
      );
      const newIndex = groups.findIndex(
        (group) => `group-${group.id}` === over?.id,
      );

      if (oldIndex !== -1 && newIndex !== -1) {
        // 实现组的拖拽重排序
        chatStore.moveGroup(oldIndex, newIndex);
      }
    }
  };

  // 渲染组列表视图
  if (chatListGroupView === "groups") {
    return (
      <div className={groupSessionsStyles["group-sessions-view"]}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={groups.map((group) => `group-${group.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className={chatItemStyles["chat-list"]}>
              {groups.map((group, i) => (
                <ChatItem
                  key={group.id}
                  id={`group-${group.id}`}
                  index={i}
                  title={group.title}
                  count={group.messageCount}
                  selected={i === currentGroupIndex}
                  status={group.status}
                  onClick={() => handleGroupClick(i)}
                  prefixType="count"
                  prefixValue={group.sessionIds.length}
                  styleCalculator={getGroupChatItemStyle}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  // 渲染组内会话列表视图
  if (chatListGroupView === "group-sessions") {
    const currentGroup = groups[currentGroupIndex];

    if (!currentGroup) {
      return null;
    }

    const groupSessions = currentGroup.sessionIds
      .map((sessionId: string) => chatStore.groupSessions[sessionId])
      .filter(Boolean);

    return (
      <div className={groupSessionsStyles["group-sessions-view"]}>
        {/* 组内会话列表 */}
        <div className={chatItemStyles["chat-list"]}>
          {groupSessions.map((session: any, i: number) => (
            <ChatItem
              key={session.id}
              id={session.id}
              index={i}
              title={session.sourceName || session.title}
              count={session.messageCount}
              selected={i === currentGroup.currentSessionIndex}
              status={session.status}
              onClick={() => handleGroupSessionClick(i)}
              onDelete={async () => {
                await chatStore.deleteGroupSession(session.id);
              }}
              prefixType="index"
              showIndex={true}
              totalCount={groupSessions.length}
              styleCalculator={getGroupChatItemStyle}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
