import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChatStore, ChatGroup } from "../store";
import { Path } from "../constant";
import { ChatItem } from "./chat-list";
import chatItemStyles from "../styles/chat-item.module.scss";
import groupSessionsStyles from "../styles/group-sessions.module.scss";
import BackIcon from "../icons/left.svg";
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
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";

// 组项目组件
function GroupItem(props: {
  onClick?: () => void;
  title: string;
  count: number;
  selected: boolean;
  id: string;
  index: number;
  status: "normal" | "error" | "pending";
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);

  // 使用 @dnd-kit 的 useSortable hook
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group-${props.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 计算状态点
  let statusDot: JSX.Element | null = null;
  if (props.status === "pending") {
    statusDot = (
      <span
        className={
          chatItemStyles["chat-item-status-dot"] +
          " " +
          chatItemStyles["chat-item-status-dot-yellow"]
        }
        title="组内有用户消息待回复"
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
        title="组内有会话出现错误"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={
        chatItemStyles["chat-item"] +
        (props.selected ? " " + chatItemStyles["chat-item-selected"] : "")
      }
      onClick={props.onClick}
      style={style}
      title={`${props.title}\n组内会话数: ${props.count}`}
      {...attributes}
      {...listeners}
    >
      <>
        <div className={chatItemStyles["chat-item-title"]}>
          <span
            className={chatItemStyles["group-item-count-prefix"]}
            style={{
              minWidth: `${Math.max(16, Math.floor(Math.log10(props.count || 1) + 1) * 6)}px`,
            }}
          >
            {props.count}
          </span>
          <span>{props.title}</span>
        </div>
        {statusDot}
      </>
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
  const navigate = useNavigate();

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

  // 处理组的点击 - 根据是否已选中决定行为
  const handleGroupClick = (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group || group.sessionIds.length === 0) return;

    // 判断是否是第一次点击该组（当前组索引不是这个组）
    if (currentGroupIndex !== groupIndex) {
      // 第一次点击：切换到该组，选择第一个会话，并切换到组内会话视图
      chatStore.selectGroup(groupIndex);
      chatStore.selectGroupSession(0, false);
      // 导航到聊天页面
      navigate(Path.Chat);
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
    // 导航到聊天页面
    navigate(Path.Chat);
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
        // TODO: 实现组的拖拽重排序
        // chatStore.moveGroup(oldIndex, newIndex);
      }
    }
  };

  // 渲染组列表视图
  if (chatListGroupView === "groups") {
    return (
      <div className={groupSessionsStyles["group-sessions-view"]}>
        {/* 在 groups view 中也显示 header，但返回按钮不可用 */}
        <div className={groupSessionsStyles["group-sessions-header"]}>
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
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          modifiers={[
            restrictToVerticalAxis,
            restrictToFirstScrollableAncestor,
          ]}
        >
          <SortableContext
            items={groups.map((group) => `group-${group.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className={chatItemStyles["chat-list"]}>
              {groups.map((group, i) => (
                <GroupItem
                  key={group.id}
                  id={group.id}
                  index={i}
                  title={group.title}
                  count={group.sessionIds.length}
                  selected={i === currentGroupIndex}
                  status={group.status}
                  onClick={() => handleGroupClick(i)}
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
        {/* 返回按钮 */}
        <div className={groupSessionsStyles["group-sessions-header"]}>
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
        </div>

        {/* 组内会话列表 */}
        <div className={chatItemStyles["chat-list"]}>
          {groupSessions.map((session: any, i: number) => (
            <ChatItem
              key={session.id}
              id={session.id}
              index={i}
              title={session.title}
              count={session.messageCount}
              selected={i === currentGroup.currentSessionIndex}
              status={session.status}
              onClick={() => handleGroupSessionClick(i)}
              onDelete={async () => {
                await chatStore.deleteGroupSession(session.id);
              }}
              showIndex={true}
              totalCount={groupSessions.length}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
