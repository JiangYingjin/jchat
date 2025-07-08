import { useState } from "react";
import { IconButton } from "./button";
import { ChatMessage, createMessage } from "../store";
import { MultimodalContent, ROLES } from "../client/api";
import { Input, Select } from "./ui-lib";
import Locale from "../locales";
import chatStyle from "./chat.module.scss";
import { getMessageTextContent, getMessageImages } from "../utils";
import { Updater } from "../typing";

import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import DragIcon from "../icons/drag.svg";

import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

// drag and drop helper function
function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = [...list];
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

function MessageListItem(props: {
  index: number;
  message: ChatMessage;
  update: (message: ChatMessage) => void;
  remove: () => void;
  onModalClose?: () => void;
}) {
  const [focusingInput, setFocusingInput] = useState(false);

  return (
    <div className={chatStyle["message-list-row"]}>
      {!focusingInput && (
        <>
          <div className={chatStyle["message-drag"]}>
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
            {ROLES.map((r) => (
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
  const context = props.context;

  const addMessage = (message: ChatMessage, i: number) => {
    props.updateContext((context) => context.splice(i, 0, message));
  };

  const removeMessage = (i: number) => {
    props.updateContext((context) => context.splice(i, 1));
  };

  const updateMessage = (i: number, message: ChatMessage) => {
    props.updateContext((context) => {
      const images = getMessageImages(context[i]);
      context[i] = message;
      if (images.length > 0) {
        const text = getMessageTextContent(context[i]);
        const newContext: MultimodalContent[] = [{ type: "text", text }];
        for (const img of images) {
          newContext.push({ type: "image_url", image_url: { url: img } });
        }
        context[i].content = newContext;
      }
    });
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) {
      return;
    }
    const newContext = reorder(
      context,
      result.source.index,
      result.destination.index,
    );
    props.updateContext((context) => {
      context.splice(0, context.length, ...newContext);
    });
  };

  return (
    <>
      <div
        className={chatStyle["message-list-editor"]}
        style={{ marginBottom: 20 }}
      >
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="message-list">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {context.map((c, i) => (
                  <Draggable
                    draggableId={c.id || i.toString()}
                    index={i}
                    key={c.id}
                  >
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                      >
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
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

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
