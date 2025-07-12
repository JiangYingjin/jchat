import { useState, useMemo } from "react";
import { IconButton } from "./button";
import { ChatMessage } from "../store";
import { createMessage } from "../utils/session";
import { MultimodalContent, ROLES } from "../client/api";
import { Input, Select } from "./ui-lib";
import Locale from "../locales";
import chatStyle from "../styles/chat.module.scss";
import { getMessageTextContent, getMessageImages } from "../utils";

import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import DragIcon from "../icons/drag.svg";

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

function MessageListItem(props: {
  index: number;
  message: ChatMessage;
  update: (message: ChatMessage) => void;
  remove: () => void;
  onModalClose?: () => void;
}) {
  const [focusingInput, setFocusingInput] = useState(false);

  // 使用 @dnd-kit 的 useSortable hook
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.message.id || props.index.toString() });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      className={chatStyle["message-list-row"]}
      style={style}
    >
      {!focusingInput && (
        <>
          <div
            className={chatStyle["message-drag"]}
            {...attributes}
            {...listeners}
          >
            <DragIcon />
          </div>
          <Select
            value={props.message.role}
            className={chatStyle["message-role"]}
            onChange={(e) =>
              props.update({
                ...props.message,
                role: e.target.value as any,
              })
            }
          >
            {ROLES.filter((r) => r !== "system").map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </>
      )}
      <Input
        value={getMessageTextContent(props.message)}
        type="text"
        className={chatStyle["message-content"]}
        rows={focusingInput ? 5 : 1}
        onFocus={() => setFocusingInput(true)}
        onBlur={() => {
          setFocusingInput(false);
          // If the selection is not removed when the user loses focus, some
          // extensions like "Translate" will always display a floating bar
          window?.getSelection()?.removeAllRanges();
        }}
        onInput={(e) =>
          props.update({
            ...props.message,
            content: e.currentTarget.value as any,
          })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            props.onModalClose?.();
          }
        }}
      />
      {!focusingInput && (
        <IconButton
          icon={<DeleteIcon />}
          className={chatStyle["message-delete-button"]}
          onClick={() => props.remove()}
          bordered
        />
      )}
    </div>
  );
}

export function MessageListEditor(props: {
  context: ChatMessage[];
  updateContext: (updater: (context: ChatMessage[]) => void) => void;
  onModalClose?: () => void;
}) {
  // 过滤掉空的 system 消息，并保持索引映射
  const { filteredMessages, indexMap } = useMemo(() => {
    const filtered: ChatMessage[] = [];
    const map: number[] = []; // 存储过滤后索引到原始索引的映射

    props.context.forEach((message, originalIndex) => {
      // 如果是 system 消息且内容为空，则过滤掉
      if (message.role === "system") {
        const textContent = getMessageTextContent(message);
        if (textContent.trim().length === 0) {
          return; // 跳过空的 system 消息
        }
      }
      // 其他消息保留
      filtered.push(message);
      map.push(originalIndex);
    });

    return {
      filteredMessages: filtered,
      indexMap: map,
    };
  }, [props.context]);

  const context = filteredMessages;

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

  const addMessage = (message: ChatMessage, filteredIndex: number) => {
    // 将过滤后的索引转换为原始索引
    let originalIndex: number;
    if (filteredIndex >= indexMap.length) {
      // 如果要添加到末尾，使用原始数组的长度
      originalIndex = props.context.length;
    } else {
      // 否则使用映射的原始索引
      originalIndex = indexMap[filteredIndex];
    }

    props.updateContext((context) => context.splice(originalIndex, 0, message));
  };

  const removeMessage = (filteredIndex: number) => {
    // 将过滤后的索引转换为原始索引
    const originalIndex = indexMap[filteredIndex];
    props.updateContext((context) => context.splice(originalIndex, 1));
  };

  const updateMessage = (filteredIndex: number, message: ChatMessage) => {
    // 将过滤后的索引转换为原始索引
    const originalIndex = indexMap[filteredIndex];
    props.updateContext((context) => {
      const images = getMessageImages(context[originalIndex]);
      context[originalIndex] = message;
      if (images.length > 0) {
        const text = getMessageTextContent(context[originalIndex]);
        const newContext: MultimodalContent[] = [{ type: "text", text }];
        for (const img of images) {
          newContext.push({ type: "image_url", image_url: { url: img } });
        }
        context[originalIndex].content = newContext;
      }
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // 找到源和目标的过滤后索引
    const sourceFilteredIndex = context.findIndex(
      (item) => item.id === active.id,
    );
    const destinationFilteredIndex = context.findIndex(
      (item) => item.id === over.id,
    );

    if (sourceFilteredIndex === -1 || destinationFilteredIndex === -1) {
      return;
    }

    // 获取源和目标的原始索引
    const sourceOriginalIndex = indexMap[sourceFilteredIndex];
    const destinationOriginalIndex = indexMap[destinationFilteredIndex];

    props.updateContext((originalContext) => {
      // 在原始数组中执行重排序
      const [movedItem] = originalContext.splice(sourceOriginalIndex, 1);
      originalContext.splice(destinationOriginalIndex, 0, movedItem);
    });
  };

  return (
    <>
      <div
        className={chatStyle["message-list-editor"]}
        style={{ marginBottom: 20 }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={context.map((c, i) => c.id || i.toString())}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {context.map((c, i) => (
                <div key={c.id || i.toString()}>
                  <MessageListItem
                    index={i}
                    message={c}
                    update={(message) => updateMessage(i, message)}
                    remove={() => removeMessage(i)}
                    onModalClose={props.onModalClose}
                  />
                  <div
                    className={chatStyle["message-list-insert"]}
                    onClick={() => {
                      addMessage(
                        createMessage({
                          role: "user",
                          content: "",
                          date: new Date().toLocaleString(),
                        }),
                        i + 1,
                      );
                    }}
                  >
                    <AddIcon />
                  </div>
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {props.context.length === 0 && (
          <div className={chatStyle["message-list-row"]}>
            <IconButton
              icon={<AddIcon />}
              text={Locale.Context.Add}
              bordered
              className={chatStyle["message-list-button"]}
              onClick={() =>
                addMessage(
                  createMessage({
                    role: "user",
                    content: "",
                    date: "",
                  }),
                  props.context.length,
                )
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
