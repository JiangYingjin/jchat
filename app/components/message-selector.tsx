import { useEffect, useMemo, useState } from "react";
import { ChatMessage, useChatStore, systemMessageStorage } from "../store";
import { Updater } from "../utils/store";
import { IconButton } from "./button";
import Locale from "../locales";
import RobotIcon from "../icons/robot.svg";
import SettingsIcon from "../icons/settings.svg";
import UserIcon from "../icons/user.svg";
import styles from "./message-selector.module.scss";
import { getMessageTextContent } from "../utils";

// 系统消息数据接口
interface SystemMessageData {
  text: string;
  images: string[];
  scrollTop: number;
  selection: { start: number; end: number };
  updateAt: number;
}

// 获取角色图标
function getRoleIcon(role: string) {
  switch (role) {
    case "system":
      return <SettingsIcon />;
    case "user":
      return <UserIcon />;
    case "assistant":
    case "model":
      return <RobotIcon />;
    default:
      return null;
  }
}

function useShiftRange() {
  const [startIndex, setStartIndex] = useState<number>();
  const [endIndex, setEndIndex] = useState<number>();
  const [shiftDown, setShiftDown] = useState(false);

  const onClickIndex = (index: number) => {
    if (shiftDown && startIndex !== undefined) {
      setEndIndex(index);
    } else {
      setStartIndex(index);
      setEndIndex(undefined);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      setShiftDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      setShiftDown(false);
      setStartIndex(undefined);
      setEndIndex(undefined);
    };

    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return {
    onClickIndex,
    startIndex,
    endIndex,
  };
}

export function useMessageSelector() {
  const [selection, setSelection] = useState(new Set<string>());
  const updateSelection: Updater<Set<string>> = (updater) => {
    const newSelection = new Set<string>(selection);
    updater(newSelection);
    setSelection(newSelection);
  };

  return {
    selection,
    updateSelection,
  };
}

export function MessageSelector(props: {
  selection: Set<string>;
  updateSelection: Updater<Set<string>>;
  defaultSelectAll?: boolean;
  onSelected?: (messages: ChatMessage[]) => void;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [systemMessageData, setSystemMessageData] =
    useState<SystemMessageData | null>(null);

  const isValid = (m: ChatMessage) => m.content && !m.isError && !m.streaming;

  const allMessages = useMemo(() => {
    // Clear context functionality has been removed, use all messages
    return session.messages;
  }, [session.messages]);

  // 加载系统提示词
  useEffect(() => {
    async function loadSystemMessage() {
      try {
        const data = await systemMessageStorage.get(session.id);
        setSystemMessageData(data);
      } catch (error) {
        console.error("Failed to load system message:", error);
        setSystemMessageData(null);
      }
    }
    loadSystemMessage();
  }, [session.id]);

  const messages = useMemo(() => {
    const filteredMessages = allMessages.filter(
      (m, i) =>
        m.id && // message must have id
        isValid(m) &&
        (m.role === "system" ||
          i >= allMessages.length - 1 ||
          isValid(allMessages[i + 1])),
    );

    // 如果有系统提示词数据且内容不为空，添加一个虚拟的系统消息用于显示
    if (
      systemMessageData &&
      (systemMessageData.text.trim() || systemMessageData.images.length > 0)
    ) {
      const systemMessage: ChatMessage = {
        id: `system-${session.id}`,
        role: "system",
        content: systemMessageData.text,
        date: new Date(systemMessageData.updateAt).toISOString(),
      };
      return [systemMessage, ...filteredMessages];
    }

    return filteredMessages;
  }, [allMessages, systemMessageData, session.id]);

  const messageCount = messages.length;

  const [searchInput, setSearchInput] = useState("");
  const [searchIds, setSearchIds] = useState(new Set<string>());
  const isInSearchResult = (id: string) => {
    return searchInput.length === 0 || searchIds.has(id);
  };
  const doSearch = (text: string) => {
    const searchResults = new Set<string>();
    if (text.length > 0) {
      messages.forEach((m) => {
        const content =
          m.role === "system" && m.id?.startsWith("system-")
            ? systemMessageData?.text || ""
            : getMessageTextContent(m);
        if (content.includes(text)) {
          searchResults.add(m.id!);
        }
      });
    }
    setSearchIds(searchResults);
  };

  // for range selection
  const { startIndex, endIndex, onClickIndex } = useShiftRange();

  const selectAll = () => {
    props.updateSelection((selection) =>
      messages.forEach((m) => {
        selection.add(m.id!);
      }),
    );
  };

  useEffect(() => {
    if (props.defaultSelectAll) {
      selectAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startIndex === undefined || endIndex === undefined) {
      return;
    }
    const [start, end] = [startIndex, endIndex].sort((a, b) => a - b);
    props.updateSelection((selection) => {
      for (let i = start; i <= end; i += 1) {
        selection.add(messages[i].id ?? i);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIndex, endIndex]);

  return (
    <div className={styles["message-selector"]}>
      <div className={styles["message-filter"]}>
        <input
          type="text"
          placeholder={Locale.Select.Search}
          className={styles["filter-item"] + " " + styles["search-bar"]}
          value={searchInput}
          onInput={(e) => {
            setSearchInput(e.currentTarget.value);
            doSearch(e.currentTarget.value);
          }}
        ></input>

        <div className={styles["actions"]}>
          <IconButton
            text={Locale.Select.All}
            bordered
            className={styles["filter-item"]}
            onClick={selectAll}
          />
          <IconButton
            text={Locale.Select.Clear}
            bordered
            className={styles["filter-item"]}
            onClick={() =>
              props.updateSelection((selection) => selection.clear())
            }
          />
        </div>
      </div>

      <div className={styles["messages"]}>
        {messages.map((m, i) => {
          if (!isInSearchResult(m.id!)) return null;
          const id = m.id ?? i;
          const isSelected = props.selection.has(id);
          const isSystemMessage =
            m.role === "system" && m.id?.startsWith("system-");

          return (
            <div
              className={`${styles["message"]} ${
                props.selection.has(m.id!) && styles["message-selected"]
              }`}
              key={i}
              data-role={m.role}
              onClick={() => {
                props.updateSelection((selection) => {
                  selection.has(id) ? selection.delete(id) : selection.add(id);
                });
                onClickIndex(i);
              }}
            >
              <div className={styles["role-icon"]}>{getRoleIcon(m.role)}</div>

              <div className={styles["body"]}>
                <div className={styles["date"]}>
                  {m.role === "system"
                    ? "系统提示词"
                    : new Date(m.date).toLocaleString()}
                </div>
                <div className={`${styles["content"]} one-line`}>
                  {isSystemMessage
                    ? systemMessageData?.text || ""
                    : getMessageTextContent(m)}
                </div>
              </div>

              <div className={styles["checkbox"]}>
                <input type="checkbox" checked={isSelected} readOnly />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
