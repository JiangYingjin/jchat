import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";
import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useRef, useMemo } from "react";
import { showConfirm } from "./ui-lib";
import { useMobileScreen } from "../utils";

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
  narrow?: boolean;
  status: "normal" | "error" | "pending";
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  const { pathname: currentPath } = useLocation();
  const dynamicStyle = useMemo(
    () => getChatItemStyle(props.count),
    [props.count],
  );
  // 选中状态加粗字体
  const isActive =
    props.selected && (currentPath === Path.Chat || currentPath === Path.Home);
  // 标记点逻辑
  let statusDot: JSX.Element | null = null;
  if (props.status === "pending") {
    statusDot = (
      <span
        className={
          styles["chat-item-status-dot"] +
          " " +
          styles["chat-item-status-dot-yellow"]
        }
        title="用户消息待回复"
      />
    );
  } else if (props.status === "error") {
    statusDot = (
      <span
        className={
          styles["chat-item-status-dot"] +
          " " +
          styles["chat-item-status-dot-red"]
        }
        title="会话出现错误"
      />
    );
  }
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={
            styles["chat-item"] +
            (isActive ? " " + styles["chat-item-selected"] : "")
          }
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={{
            ...dynamicStyle,
            ...provided.draggableProps.style,
          }}
          title={`${props.title}\n${Locale.ChatItem.ChatItemCount(props.count)}`}
        >
          {props.narrow ? (
            <div className={styles["chat-item-narrow"]}>
              <div className={styles["chat-item-narrow-count"]}>
                {props.count}
              </div>
              {statusDot}
            </div>
          ) : (
            <>
              <div className={styles["chat-item-title"]}>{props.title}</div>
              {statusDot}
            </>
          )}
        </div>
      )}
    </Draggable>
  );
}

export function ChatList(props: { narrow?: boolean }) {
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
  const isMobileScreen = useMobileScreen();

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    moveSession(source.index, destination.index);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="chat-list">
        {(provided) => (
          <div
            className={styles["chat-list"]}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
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
                  if (
                    (!props.narrow && !isMobileScreen) ||
                    true ||
                    (await showConfirm(Locale.Home.DeleteChat))
                  ) {
                    await chatStore.deleteSession(i);
                  }
                }}
                narrow={props.narrow}
                status={item.status}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
