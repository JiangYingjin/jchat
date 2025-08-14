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
import { useChatStore } from "../store";
import sidebarStyles from "../styles/sidebar.module.scss";
import SearchIcon from "../icons/search.svg";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import { Markdown } from "./markdown";
import { useRouter } from "next/navigation";
import { Path } from "@/app/constant";
import Locale from "../locales";
import { getMessageTextContent } from "../utils";
import { searchService, SearchResult, SearchStats } from "../services/search";
import { ChatMessage } from "../store/message";
import { SystemMessageData } from "../store/system";

// 搜索状态枚举
enum SearchState {
  IDLE = "idle",
  SEARCHING = "searching",
  SUCCESS = "success",
  ERROR = "error",
}

// 搜索错误类型
interface SearchError {
  message: string;
  code?: string;
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

/**
 * 计算字符串的显示长度（中文字符=1，数字/英文字符=0.5，空格换行忽略）
 */
function getDisplayLength(str: string): number {
  let length = 0;
  for (const char of str) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      // 中文字符
      length += 1;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      // 英文字母和数字
      length += 0.5;
    }
    // 空格、换行等忽略不计
  }
  return length;
}

/**
 * 优化的文本截取算法
 * 搜索关键词左侧截取16个字符，右侧截取40个字符
 * 换行用空格替换，连续空格合并为一个
 */
function optimizedTextTruncate(
  str: string,
  search: string,
  leftChars: number = 16,
  rightChars: number = 40,
): string {
  if (!str) return "";

  // 预处理：换行替换为空格，连续空格合并
  const cleanStr = str.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  if (!search) {
    // 没有搜索词时，从头截取总共56个字符 (16+40)
    let result = "";
    let currentLength = 0;
    const totalChars = leftChars + rightChars;
    for (const char of cleanStr) {
      const charLength = getDisplayLength(char);
      if (currentLength + charLength > totalChars) break;
      result += char;
      currentLength += charLength;
    }
    return result + (result.length < cleanStr.length ? "..." : "");
  }

  const index = cleanStr.toLowerCase().indexOf(search.toLowerCase());
  if (index === -1) {
    // 找不到搜索词，从头截取
    let result = "";
    let currentLength = 0;
    const totalChars = leftChars + rightChars;
    for (const char of cleanStr) {
      const charLength = getDisplayLength(char);
      if (currentLength + charLength > totalChars) break;
      result += char;
      currentLength += charLength;
    }
    return result + (result.length < cleanStr.length ? "..." : "");
  }

  // 找到搜索词，左侧固定16字符，右侧固定40字符

  // 向前寻找起始位置 - 左侧16字符
  let startIndex = index;
  let beforeLength = 0;
  for (let i = index - 1; i >= 0 && beforeLength < leftChars; i--) {
    const charLength = getDisplayLength(cleanStr[i]);
    if (beforeLength + charLength > leftChars) break;
    beforeLength += charLength;
    startIndex = i;
  }

  // 向后寻找结束位置 - 右侧40字符
  let endIndex = index + search.length;
  let afterLength = 0;
  for (let i = endIndex; i < cleanStr.length && afterLength < rightChars; i++) {
    const charLength = getDisplayLength(cleanStr[i]);
    if (afterLength + charLength > rightChars) break;
    afterLength += charLength;
    endIndex = i + 1;
  }

  let result = cleanStr.slice(startIndex, endIndex);

  // 添加省略号
  if (startIndex > 0) {
    result = "..." + result;
  }
  if (endIndex < cleanStr.length) {
    result = result + "...";
  }

  return result;
}

function highlightText(str: string, search: string): string {
  if (!str || !search) return str;

  // 使用安全的正则表达式进行高亮，不使用Markdown渲染
  const safeSearch = escapeRegExp(search);
  return str.replace(new RegExp(`(${safeSearch})`, "gi"), "**$1**");
}

// 高亮显示文本组件（纯文本版本，不使用Markdown渲染）
function HighlightedText({
  text,
  search,
  leftChars = 16,
  rightChars = 40,
}: {
  text: string;
  search: string;
  leftChars?: number;
  rightChars?: number;
}) {
  const processedText = useMemo(() => {
    const truncated = optimizedTextTruncate(
      text,
      search,
      leftChars,
      rightChars,
    );
    return highlightText(truncated, search);
  }, [text, search, leftChars, rightChars]);

  // 简单的高亮渲染，将 **text** 转换为 <strong>text</strong>
  const renderHighlightedText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    return parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={index} className={sidebarStyles["search-highlight"]}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <span className={sidebarStyles["search-highlighted-text"]}>
      {renderHighlightedText(processedText)}
    </span>
  );
}

// 嵌入式消息显示组件 - 图标嵌入在文本开头
function EmbeddedMessage({
  message,
  search,
}: {
  message: ChatMessage;
  search: string;
}) {
  const messageText = getMessageTextContent(message);
  const roleIcon = message.role === "user" ? "👤" : "🤖";

  const truncatedText = optimizedTextTruncate(messageText, search, 16, 40);
  const highlightedText = highlightText(truncatedText, search);

  // 简单的高亮渲染
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    return parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={index} className={sidebarStyles["search-highlight"]}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className={sidebarStyles["search-message-embedded"]}>
      <span className={sidebarStyles["search-message-text"]}>
        <span className={sidebarStyles["search-role-icon"]}>{roleIcon}</span>
        {renderText(highlightedText)}
      </span>
    </div>
  );
}

// 嵌入式系统消息显示组件 - 无左边框样式
function EmbeddedSystemMessage({
  systemMessage,
  search,
}: {
  systemMessage: { text: string };
  search: string;
}) {
  const truncatedText = optimizedTextTruncate(
    systemMessage.text,
    search,
    16,
    40,
  );
  const highlightedText = highlightText(truncatedText, search);

  // 简单的高亮渲染
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    return parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={index} className={sidebarStyles["search-highlight"]}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className={sidebarStyles["search-system-embedded"]}>
      <span className={sidebarStyles["search-message-text"]}>
        <span className={sidebarStyles["search-role-icon"]}>⚙️</span>
        {renderText(highlightedText)}
      </span>
    </div>
  );
}

function SearchResultItem({
  result,
  input,
  selectSession,
}: {
  result: SearchResult;
  input: string;
  selectSession: (sessionId: string) => void;
}) {
  const router = useRouter();
  const sessions = useChatStore((state) => state.sessions);

  const handleClick = () => {
    const sessionIndex = sessions.findIndex((s) => s.id === result.sessionId);
    if (sessionIndex !== -1) {
      router.push(Path.Home);
      selectSession(result.sessionId);
    }
  };

  // 移除匹配类型显示文本，为标题腾出更多空间

  return (
    <div
      className={`${sidebarStyles["search-result-item"]} ${sidebarStyles[`search-result-${result.matchType}`]}`}
      onClick={handleClick}
    >
      <div className={sidebarStyles["search-item-header"]}>
        <div className={sidebarStyles["search-item-title"]}>
          {result.matchType === "title" ? (
            <HighlightedText text={result.topic} search={input} />
          ) : (
            result.topic
          )}
        </div>
        {/* 移除匹配类型标签，让标题有更多空间完整显示 */}
      </div>

      <div className={sidebarStyles["search-item-content"]}>
        {/* 显示匹配的消息 - 嵌入式布局 */}
        {result.matchedMessages.length > 0 && (
          <div className={sidebarStyles["search-matched-messages-embedded"]}>
            {result.matchedMessages.slice(0, 2).map((message) => (
              <EmbeddedMessage
                key={message.id}
                message={message}
                search={input}
              />
            ))}
          </div>
        )}

        {/* 显示匹配的系统消息 - 嵌入式布局，无左边框 */}
        {result.matchedSystemMessage && (
          <EmbeddedSystemMessage
            systemMessage={result.matchedSystemMessage}
            search={input}
          />
        )}

        {/* 统计信息放在系统消息之后，计算总匹配项 */}
        {result.matchedMessages.length > 2 && (
          <div className={sidebarStyles["search-more-count"]}>
            共{" "}
            {result.matchedMessages.length +
              (result.matchedSystemMessage ? 1 : 0)}{" "}
            个匹配项
          </div>
        )}
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
  const selectSession = useChatStore((state) => state.selectSession);

  // 基础状态
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>(SearchState.IDLE);
  const [searchStats, setSearchStats] = useState<SearchStats | null>(null);
  const [searchError, setSearchError] = useState<SearchError | null>(null);

  // 防抖和取消相关
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchRef = useRef<string>("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => ({
    setInput: handleSetInput,
    clearInput: handleClearInput,
    inputElement: inputRef.current,
  }));

  // 设置输入值的函数
  const handleSetInput = useCallback((value: string) => {
    setInput(value);
  }, []);

  // 清空输入和搜索结果
  const handleClearInput = useCallback(() => {
    // 取消当前搜索
    searchService.cancelCurrentSearch();
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    // 清空状态
    setInput("");
    setResults([]);
    setSearchState(SearchState.IDLE);
    setSearchStats(null);
    setSearchError(null);
    setIsSearching(false);
    lastSearchRef.current = "";
  }, [setIsSearching]);

  // 执行搜索
  const performSearch = useCallback(async (query: string) => {
    if (query === lastSearchRef.current) {
      return; // 相同查询，不重复搜索
    }

    lastSearchRef.current = query;

    try {
      setSearchState(SearchState.SEARCHING);

      const searchResult = await searchService.search(query, {
        caseSensitive: false,
        searchInSystemMessages: true,
        // 不限制搜索结果数量
      });

      // 检查是否仍然是当前查询（避免竞态条件）
      if (lastSearchRef.current === query) {
        setResults(searchResult.results);
        setSearchStats(searchResult.stats);
        setSearchState(SearchState.SUCCESS);
        console.log(
          `[搜索统计] 总用时: ${searchResult.stats.searchDuration}ms, 结果: ${searchResult.results.length}`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Search aborted") {
        console.log("[SearchBar] 搜索被取消");
        return;
      }

      console.error("[SearchBar] 搜索失败:", error);
      setSearchError({
        message: error instanceof Error ? error.message : "搜索失败",
        code: "SEARCH_ERROR",
      });
      setSearchState(SearchState.ERROR);
      setResults([]);
    }
  }, []);

  // 处理输入变化
  const handleChange = useCallback(
    (value: string) => {
      setInput(value);

      // 如果输入为空，直接清空结果
      if (value.trim().length === 0) {
        handleClearInput();
        return;
      }

      setIsSearching(true);
      setSearchState(SearchState.SEARCHING);
      setSearchError(null);

      // 清空现有结果，重新开始搜索
      setResults([]);
      setSearchStats(null);

      // 取消之前的搜索
      searchService.cancelCurrentSearch();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // 设置新的防抖定时器
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value.trim());
      }, 300); // 300ms 防抖
    },
    [setIsSearching, handleClearInput, performSearch],
  );

  // 处理焦点
  const handleFocus = useCallback(() => {
    if (input && input.trim().length > 0) {
      setIsSearching(true);
    }
  }, [input, setIsSearching]);

  // 处理失焦
  const handleBlur = useCallback(() => {
    if (inputRef.current && inputRef.current.value.trim() === "") {
      setIsSearching(false);
    }
  }, [setIsSearching]);

  // 组件清理
  useEffect(() => {
    return () => {
      // 组件卸载时清理资源
      searchService.cancelCurrentSearch();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // 计算显示的结果
  const displayedResults = useMemo(() => results, [results]);

  // 计算加载状态
  const isLoading = searchState === SearchState.SEARCHING;
  const hasError = searchState === SearchState.ERROR;
  const hasResults = results.length > 0;
  const showResults = input.trim().length > 0;

  return (
    <>
      {/* 固定顶部区域：搜索框和统计信息 */}
      <div className={sidebarStyles["sidebar-search-bar-fixed-top"]}>
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
        {showResults && (
          <div className={sidebarStyles["search-item-total-count"]}>
            {isLoading && (
              <div className={sidebarStyles["search-loading"]}>
                <div className={sidebarStyles["search-spinner"]}></div>
                搜索中...
              </div>
            )}
            {hasError && searchError && (
              <div className={sidebarStyles["search-error"]}>
                搜索失败: {searchError.message}
              </div>
            )}
            {!isLoading && !hasError && (
              <div className={sidebarStyles["search-stats"]}>
                {displayedResults.length} 个会话
                {searchStats && (
                  <span className={sidebarStyles["search-duration"]}>
                    · {searchStats.searchDuration}ms
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {showResults && !isLoading && !hasError && (
        <div className={sidebarStyles["search-result"]}>
          {hasResults
            ? displayedResults.map((result) => (
                <SearchResultItem
                  key={result.sessionId}
                  result={result}
                  input={input}
                  selectSession={(sessionId: string) => {
                    const sessions = useChatStore.getState().sessions;
                    const sessionIndex = sessions.findIndex(
                      (s) => s.id === sessionId,
                    );
                    if (sessionIndex !== -1) {
                      selectSession(sessionIndex);
                    }
                  }}
                />
              ))
            : searchState === SearchState.SUCCESS && (
                <div className={sidebarStyles["search-no-results"]}>
                  未找到匹配的结果
                </div>
              )}
        </div>
      )}
    </>
  );
}
export const SearchBar = forwardRef<SearchInputRef, SearchBarProps>(
  SearchBarComponent,
);
