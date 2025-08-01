import {
  forwardRef,
  Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatMessage, useChatStore } from "../store";
import sidebarStyles from "../styles/sidebar.module.scss";
import SearchIcon from "../icons/search.svg";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import { Markdown } from "./markdown";
import { useRouter } from "next/navigation";
import { Path } from "@/app/constant";
import Locale from "../locales";
import { getMessageTextContent } from "../utils";

interface SearchResult {
  sessionId: string;
  topic: string;
  lastUpdate: number;
  message: ChatMessage[];
}

interface SearchBarProps {
  setIsSearching: (isSearching: boolean) => void;
  className?: string;
}

export interface SearchInputRef {
  setInput: (value: string) => void;
  clearInput: () => void;
  inputElement: HTMLInputElement | null;
}

function escapeRegExp(search: string) {
  return search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightAndShorten(str: string, search: string) {
  const index = str.toLowerCase().indexOf(search.toLowerCase());
  const head = Math.max(0, index - 10);
  const tail = Math.min(str.length, index + search.length + 40);
  // Remove code block syntax
  let result = str.slice(head, tail);
  const safeSearch = escapeRegExp(search);
  // Use ** to highlight the search result
  result = result.replace(new RegExp(`(${safeSearch})`), "**$1**");

  if (head > 0) {
    result = "..." + result;
  }

  if (tail < str.length) {
    result = result + "...";
  }

  return result;
}

function HighlightedMessage({
  message,
  search,
}: {
  message: ChatMessage;
  search: string;
}) {
  const highlightedMessage = useMemo(
    () => highlightAndShorten(getMessageTextContent(message), search),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getMessageTextContent(message), search],
  );
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className={sidebarStyles["search-item-text"]}>
      <Markdown
        content={highlightedMessage}
        loading={false}
        defaultShow={true}
        parentRef={ref}
      />
    </div>
  );
}

function SearchResultItem({
  result,
  input,
  selectSession,
  index,
}: {
  result: SearchResult;
  input: string;
  selectSession: (id: number) => void;
  index: number;
}) {
  const router = useRouter();

  return (
    <div
      className={sidebarStyles["search-result-item"]}
      onClick={() => {
        router.push(Path.Home);
        selectSession(index);
      }}
    >
      <div className={sidebarStyles["search-item-title"]}>{result.topic}</div>
      <div className={sidebarStyles["search-item-text-container"]}>
        {result.message.map((message) => (
          <HighlightedMessage
            key={message.id}
            message={message}
            search={input}
          />
        ))}
      </div>
      <div className={sidebarStyles["search-item-info"]}>
        <div className={sidebarStyles["search-item-date"]}>
          {new Date(result.lastUpdate).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function SearchBarComponent(
  { setIsSearching, className }: SearchBarProps,
  ref: Ref<SearchInputRef>,
) {
  const [sessions, selectSession] = useChatStore((state) => [
    state.sessions,
    state.selectSession,
  ]);

  const [input, setInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => ({
    setInput,
    clearInput: handleClearInput,
    inputElement: inputRef.current,
  }));

  const handleClearInput = useCallback(() => {
    setInput("");
    setResults([]);
    setIsSearching(false);
  }, [setIsSearching]);

  const handleChange = useCallback(
    (value: string) => {
      setIsSearching(true);
      setInput(value);
    },
    [setIsSearching],
  );

  const handleFocus = useCallback(() => {
    if (input && input.trim().length > 0) setIsSearching(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIsSearching]);

  const handleBlur = useCallback(() => {
    if (
      (inputRef as React.RefObject<HTMLInputElement>).current &&
      (inputRef as React.RefObject<HTMLInputElement>)?.current?.value.trim() ===
        ""
    ) {
      setIsSearching(false);
    }
  }, [setIsSearching]);

  // 当用户输入变化时，执行搜索操作
  useEffect(() => {
    if (input.trim().length === 0) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    const newResults: SearchResult[] = [];

    for (const session of sessions) {
      const matchingMessages: ChatMessage[] = [];

      for (const message of session.messages) {
        if (
          getMessageTextContent(message)
            .toLowerCase()
            .includes(input.toLowerCase())
        ) {
          matchingMessages.push(message!);
        }
      }

      if (matchingMessages.length > 0) {
        newResults.push({
          topic: session.title,
          sessionId: session.id,
          lastUpdate: session.lastUpdate,
          message: matchingMessages,
        });
      }
    }

    setResults(newResults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sessions]);

  const displayedResults = useMemo(() => results, [results]);

  return (
    <>
      <div className={sidebarStyles["sidebar-search-bar-input"]}>
        <SearchIcon className={sidebarStyles["search-icon"]} />
        <input
          className={sidebarStyles["search-input"]}
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={Locale.Search.Title}
        />
        {input.trim().length > 0 && (
          <IconButton
            className={sidebarStyles["clear-icon"]}
            icon={<CloseIcon />}
            onClick={handleClearInput}
          />
        )}
      </div>
      {input.trim().length > 0 && (
        <div className={sidebarStyles["search-item-total-count"]}>
          {displayedResults.length} chats found
        </div>
      )}
      <div className={sidebarStyles["search-result"]}>
        {displayedResults.map((result) => (
          <SearchResultItem
            key={result.sessionId}
            result={result}
            input={input}
            selectSession={selectSession}
            index={sessions.findIndex(
              (session) => session.id === result.sessionId,
            )}
          />
        ))}
      </div>
    </>
  );
}
export const SearchBar = forwardRef<SearchInputRef, SearchBarProps>(
  SearchBarComponent,
);
