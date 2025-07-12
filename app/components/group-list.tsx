import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChatStore, ChatGroup } from "../store";
import { Path } from "../constant";
import { ChatItem } from "./chat-list";
import styles from "./home.module.scss";
import { IconButton } from "./button";
import BackIcon from "../icons/left.svg";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

// 组项目组件
function GroupItem(props: {
  onClick?: () => void;
  onDoubleClick?: () => void;
  title: string;
  count: number;
  selected: boolean;
  id: string;
  index: number;
  status: "normal" | "error" | "pending";
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);

  // 计算状态点
  let statusDot: JSX.Element | null = null;
  if (props.status === "pending") {
    statusDot = (
      <span
        className={
          styles["chat-item-status-dot"] +
          " " +
          styles["chat-item-status-dot-yellow"]
        }
        title="组内有用户消息待回复"
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
        title="组内有会话出现错误"
      />
    );
  }

  return (
    <Draggable draggableId={`group-${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={
            styles["chat-item"] +
            (props.selected ? " " + styles["chat-item-selected"] : "")
          }
          onClick={props.onClick}
          onDoubleClick={props.onDoubleClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={{
            ...provided.draggableProps.style,
          }}
          title={`${props.title}\n组内会话数: ${props.count}`}
        >
          <>
            <div className={styles["chat-item-title"]}>{props.title}</div>
            {statusDot}
          </>
        </div>
      )}
    </Draggable>
  );
}

// 组会话列表组件
export function GroupList() {
  const [groups, currentGroupIndex, chatListView, chatStore] = useChatStore(
    (state) => [
      state.groups,
      state.currentGroupIndex,
      state.chatListView,
      state,
    ],
  );
  const navigate = useNavigate();

  // 处理组的单击 - 切换到该组并显示组内第一个会话
  const handleGroupClick = (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group || group.sessionIds.length === 0) return;

    // 获取组内第一个会话
    const firstSessionId = group.sessionIds[0];
    const firstSession = chatStore.groupSessions[firstSessionId];

    if (firstSession) {
      // 切换到该组
      chatStore.selectGroup(groupIndex);
      // 切换到组内第一个会话
      chatStore.selectGroupSession(0);
      // 导航到聊天页面
      navigate(Path.Chat);
    }
  };

  // 处理组的双击 - 展开组内会话列表
  const handleGroupDoubleClick = (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group) return;

    // 选择组并切换到组内会话模式
    chatStore.selectGroup(groupIndex);
    chatStore.setchatListView("group-sessions");
  };

  // 返回到组列表
  const handleBackToGroups = () => {
    chatStore.setchatListView("groups");
  };

  // 处理组内会话的点击
  const handleGroupSessionClick = (sessionIndex: number) => {
    // 选择该会话
    chatStore.selectGroupSession(sessionIndex);
    // 导航到聊天页面
    navigate(Path.Chat);
  };

  // 拖拽处理
  const onDragEnd = (result: any) => {
    const { destination, source } = result;
    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    // TODO: 实现组的拖拽重排序
    // chatStore.moveGroup(source.index, destination.index);
  };

  // 渲染组列表视图
  if (chatListView === "groups") {
    return (
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="group-list">
          {(provided) => (
            <div
              className={styles["chat-list"]}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
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
                  onDoubleClick={() => handleGroupDoubleClick(i)}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    );
  }

  // 渲染组内会话列表视图
  if (chatListView === "group-sessions") {
    const currentGroup = groups[currentGroupIndex];

    if (!currentGroup) {
      return null;
    }

    const groupSessions = currentGroup.sessionIds
      .map((sessionId: string) => chatStore.groupSessions[sessionId])
      .filter(Boolean);

    return (
      <div className={styles["group-sessions-view"]}>
        {/* 返回按钮 */}
        <div className={styles["group-sessions-header"]}>
          <IconButton
            icon={<BackIcon />}
            onClick={handleBackToGroups}
            title="返回组列表"
            className={styles["back-button"]}
          />
          <span className={styles["group-sessions-title"]}>
            {currentGroup.title}
          </span>
        </div>

        {/* 组内会话列表 */}
        <div className={styles["chat-list"]}>
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
              onDelete={() => {
                // TODO: 实现删除组内会话的功能
                console.log("删除组内会话:", session.id);
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
