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
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";

import { useChatStore } from "../store";
import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useRef, useMemo } from "react";

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

export function ChatItem(props: {
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  count: number;
  selected: boolean;
  id: string;
  index: number;
  status: "normal" | "error" | "pending";
  showIndex?: boolean; // 是否显示序号前缀
  totalCount?: number; // 总数量，用于计算对齐
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  const { pathname: currentPath } = useLocation();
  const dynamicStyle = useMemo(
    () => getChatItemStyle(props.count),
    [props.count],
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
  // 标记点逻辑
  let statusDot: JSX.Element | null = null;
  if (props.status === "pending") {
    statusDot = (
      <span
        className={
          chatItemStyles["chat-item-status-dot"] +
          " " +
          chatItemStyles["chat-item-status-dot-yellow"]
        }
        title="用户消息待回复"
      />
    );
  } else if (props.status === "error") {
    statusDot = (
      <span
        className={
          chatItemStyles["chat-item-status-dot"] +
          " " +
          chatItemStyles["chat-item-status-dot-red"]
        }
        title="会话出现错误"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={
        chatItemStyles["chat-item"] +
        (isActive ? " " + chatItemStyles["chat-item-selected"] : "")
      }
      onClick={props.onClick}
      style={style}
      title={`${props.title}\n${Locale.ChatItem.ChatItemCount(props.count)}`}
      {...attributes}
      {...listeners}
    >
      <div className={chatItemStyles["chat-item-title"]}>
        {props.showIndex ? (
          <>
            <span
              className={chatItemStyles["chat-item-index-prefix"]}
              style={{
                minWidth: `${Math.max(16, Math.floor(Math.log10(props.totalCount || 1) + 1) * 6)}px`,
              }}
            >
              {props.index + 1}
            </span>
            <span>{props.title}</span>
          </>
        ) : (
          <span>{props.title}</span>
        )}
      </div>
      {statusDot}
    </div>
  );
}

export function ChatList(props: {}) {
  const [sessions, selectedIndex, selectSession, moveSession] = useChatStore(
    (state) => [
      state.sessions,
      state.currentSessionIndex,
      state.selectSession,
      state.moveSession,
    ],
  );
  const chatStore = useChatStore();
  const navigate = useNavigate();

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

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = sessions.findIndex(
        (session) => session.id === active.id,
      );
      const newIndex = sessions.findIndex((session) => session.id === over?.id);

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
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
    >
      <SortableContext
        items={sessions.map((session) => session.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={chatItemStyles["chat-list"]}>
          {sessions.map((item, i) => (
            <ChatItem
              title={item.title}
              count={item.messageCount}
              key={item.id}
              id={item.id}
              index={i}
              selected={i === selectedIndex}
              onClick={() => {
                navigate(Path.Chat);
                selectSession(i);
              }}
              onDelete={async () => {
                await chatStore.deleteSession(i);
              }}
              status={item.status}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
