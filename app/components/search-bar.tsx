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
import { createPortal } from "react-dom";
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
import {
  searchService,
  SearchResult,
  SearchStats,
  ParseError,
  AdvancedSearchParser,
  SmartHighlighter,
  HighlightSegment,
  HighlightType,
} from "../services/search";
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
  suggestion?: string; // 添加建议信息
  position?: number; // 错误位置
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

// 保留escapeRegExp函数以防其他地方使用
function escapeRegExp(search: string) {
  return search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 智能高亮显示文本组件（使用新的SmartHighlighter）
function HighlightedText({
  text,
  matchedTerms = [],
  contextType = "message",
  leftChars = 16,
  rightChars = 40,
}: {
  text: string;
  matchedTerms?: string[];
  contextType?: "title" | "message" | "system";
  leftChars?: number;
  rightChars?: number;
}) {
  const highlightSegments = useMemo(() => {
    if (!text || matchedTerms.length === 0) {
      return [{ text, isHighlighted: false }];
    }

    const highlighter = new SmartHighlighter({
      leftContextChars: leftChars,
      rightContextChars: rightChars,
    });

    return highlighter.highlight(text, matchedTerms, contextType);
  }, [text, matchedTerms, contextType, leftChars, rightChars]);

  // 渲染高亮片段
  const renderHighlightSegments = (segments: HighlightSegment[]) => {
    return segments.map((segment, index) => {
      if (segment.isHighlighted) {
        const className = getHighlightClassName(segment.highlightType);
        return (
          <strong
            key={index}
            className={`${sidebarStyles["search-highlight"]} ${className}`}
            title={
              segment.originalTerm
                ? `匹配词: ${segment.originalTerm}`
                : undefined
            }
          >
            {segment.text}
          </strong>
        );
      }
      return <span key={index}>{segment.text}</span>;
    });
  };

  // 根据高亮类型获取CSS类名
  const getHighlightClassName = (highlightType?: HighlightType): string => {
    switch (highlightType) {
      case HighlightType.EXACT:
        return sidebarStyles["search-highlight-exact"] || "";
      case HighlightType.TITLE:
        return sidebarStyles["search-highlight-title"] || "";
      case HighlightType.PARTIAL:
        return sidebarStyles["search-highlight-partial"] || "";
      case HighlightType.WORD:
      default:
        return "";
    }
  };

  return (
    <span
      className={`${sidebarStyles["search-highlighted-text"]} ${sidebarStyles[`context-${contextType}`] || ""}`}
    >
      {renderHighlightSegments(highlightSegments)}
    </span>
  );
}

// 嵌入式消息显示组件 - 图标嵌入在文本开头
function EmbeddedMessage({
  message,
  matchedTerms = [],
}: {
  message: ChatMessage;
  matchedTerms?: string[];
}) {
  const messageText = getMessageTextContent(message);
  const roleIcon = message.role === "user" ? "👤" : "🤖";

  return (
    <div className={sidebarStyles["search-message-embedded"]}>
      <span className={sidebarStyles["search-message-text"]}>
        <span className={sidebarStyles["search-role-icon"]}>{roleIcon}</span>
        <HighlightedText
          text={messageText}
          matchedTerms={matchedTerms}
          contextType="message"
          leftChars={16}
          rightChars={40}
        />
      </span>
    </div>
  );
}

// 嵌入式系统消息显示组件 - 无左边框样式
function EmbeddedSystemMessage({
  systemMessage,
  matchedTerms = [],
}: {
  systemMessage: { text: string };
  matchedTerms?: string[];
}) {
  return (
    <div className={sidebarStyles["search-system-embedded"]}>
      <span className={sidebarStyles["search-message-text"]}>
        <span className={sidebarStyles["search-role-icon"]}>⚙️</span>
        <HighlightedText
          text={systemMessage.text}
          matchedTerms={matchedTerms}
          contextType="system"
          leftChars={16}
          rightChars={40}
        />
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
  input: string; // 保留用于向后兼容，但主要使用matchedTerms
  selectSession: (sessionId: string) => void;
}) {
  const router = useRouter();
  const sessions = useChatStore((state) => state.sessions);
  const moveSession = useChatStore((state) => state.moveSession);

  // 右键菜单状态
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const itemRef = useRef<HTMLDivElement | null>(null);

  const handleClick = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const sessionIndex = sessions.findIndex((s) => s.id === result.sessionId);
    if (sessionIndex !== -1) {
      router.push(Path.Home);
      selectSession(result.sessionId);
    }
  };

  // 使用SearchResult中的matchedTerms，提供精确的高亮
  const matchedTerms = result.matchedTerms || [];

  // 监听外部点击/滚动以关闭菜单
  useEffect(() => {
    if (!menuOpen) return;

    const handleGlobalClose = (e: Event) => {
      const target = e.target as Element;
      // 如果点击的是菜单内部，不关闭
      if (target?.closest(`.${sidebarStyles["search-context-menu"]}`)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    // 延迟添加监听器，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleGlobalClose, true);
      document.addEventListener("scroll", handleGlobalClose, true);
      document.addEventListener("keydown", handleKey, true);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleGlobalClose, true);
      document.removeEventListener("scroll", handleGlobalClose, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [menuOpen]);

  return (
    <div
      className={`${sidebarStyles["search-result-item"]} ${sidebarStyles[`search-result-${result.matchType}`]}`}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        // 计算菜单位置，确保不超出视口
        const menuWidth = 160;
        const menuHeight = 80;
        const padding = 8;

        // 直接使用鼠标在视口中的坐标
        const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
        const y = Math.min(
          e.clientY,
          window.innerHeight - menuHeight - padding,
        );

        setMenuPos({ x: Math.max(padding, x), y: Math.max(padding, y) });
        setMenuOpen(true);
      }}
      ref={itemRef}
    >
      <div className={sidebarStyles["search-item-header"]}>
        <div className={sidebarStyles["search-item-title"]}>
          {result.matchType === "title" || result.matchType === "multiple" ? (
            <HighlightedText
              text={result.topic}
              matchedTerms={matchedTerms}
              contextType="title"
            />
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
                matchedTerms={matchedTerms}
              />
            ))}
          </div>
        )}

        {/* 显示匹配的系统消息 - 嵌入式布局，无左边框 */}
        {result.matchedSystemMessage && (
          <EmbeddedSystemMessage
            systemMessage={result.matchedSystemMessage}
            matchedTerms={matchedTerms}
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

      {menuOpen &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className={sidebarStyles["search-context-menu"]}
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={sidebarStyles["search-context-item"]}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const fromIndex = sessions.findIndex(
                  (s) => s.id === result.sessionId,
                );
                if (fromIndex !== -1 && fromIndex !== 0) {
                  moveSession(fromIndex, 0);
                  // 可选：将视图切换到首页并选中新位置的会话
                  router.push(Path.Home);
                }
                setMenuOpen(false);
              }}
            >
              移至顶部
            </div>
          </div>,
          document.body,
        )}
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
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);

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
    setShowSyntaxHelp(false);
    setIsSearching(false);
    lastSearchRef.current = "";
  }, [setIsSearching]);

  // 验证搜索语法
  const validateSyntax = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchError(null);
      return true;
    }

    const validation = AdvancedSearchParser.validate(query);
    if (!validation.valid && validation.error) {
      setSearchError({
        message: validation.error.message,
        suggestion: validation.error.suggestion,
        position: validation.error.position,
      });
      return false;
    }

    setSearchError(null);
    return true;
  }, []);

  // 检测是否需要显示高级语法帮助
  const shouldShowSyntaxHelp = useCallback((query: string): boolean => {
    // 当用户使用了高级语法特征时显示帮助
    const advancedFeatures = [
      /\|/, // OR 操作符
      /\([^)]*\)/, // 括号
      /（[^）]*）/, // 全角括号
      /"[^"]*"/, // 引号
      /[\u201c][\s\S]*?[\u201d]/, // 全角引号
      /标题[:：]/, // 标题前缀
      /title[:：]/i, // 英文标题前缀
    ];
    return advancedFeatures.some((pattern) => pattern.test(query));
  }, []);

  // 执行搜索
  const performSearch = useCallback(
    async (query: string) => {
      if (query === lastSearchRef.current) {
        // 如果是相同查询但当前有结果，直接设置为成功状态
        if (results.length > 0) {
          setSearchState(SearchState.SUCCESS);
          return;
        }
      }

      lastSearchRef.current = query;

      try {
        setSearchState(SearchState.SEARCHING);

        // 在真正开始搜索时才清空结果
        setResults([]);
        setSearchStats(null);
        setSearchError(null);

        const searchResult = await searchService.search(query, {
          caseSensitive: false,
          searchInSystemMessages: true,
        });

        // 检查是否仍然是当前查询（避免竞态条件）
        if (lastSearchRef.current === query) {
          setResults(searchResult.results);
          setSearchStats(searchResult.stats);
          setSearchState(SearchState.SUCCESS);
          setSearchError(null);
        }
      } catch (error) {
        // 检查错误类型
        if (error instanceof Error) {
          if (
            error.message === "Search aborted" ||
            error.name === "AbortError"
          ) {
            // 搜索被取消时，重置状态到 IDLE
            setSearchState(SearchState.IDLE);
            setResults([]);
            setSearchStats(null);
            setSearchError(null);
            return;
          }
        }

        // 只在开发环境输出搜索失败信息
        if (process.env.NODE_ENV === "development") {
          console.error("[SearchBar] 搜索失败:", error);
        }

        setSearchError({
          message: error instanceof Error ? error.message : "搜索失败",
          code: "SEARCH_ERROR",
        });
        setSearchState(SearchState.ERROR);
        setResults([]);
        setSearchStats(null);
      }
    },
    [results],
  );

  // 处理输入变化
  const handleChange = useCallback(
    (value: string) => {
      setInput(value);

      // 如果输入为空，直接清空结果
      if (value.trim().length === 0) {
        handleClearInput();
        return;
      }

      // 实时语法验证（非阻塞）
      const isValidSyntax = validateSyntax(value);

      // 设置是否显示语法帮助
      setShowSyntaxHelp(shouldShowSyntaxHelp(value));

      // 取消之前的搜索
      searchService.cancelCurrentSearch();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      setIsSearching(true);

      // 如果语法无效，立即设置错误状态
      if (!isValidSyntax) {
        setSearchState(SearchState.ERROR);
        setResults([]);
        setSearchStats(null);
        return;
      }

      // 清除错误状态，保留搜索结果直到新搜索开始
      setSearchError(null);

      // 设置新的防抖定时器
      searchTimeoutRef.current = setTimeout(() => {
        setSearchState(SearchState.SEARCHING);
        performSearch(value.trim());
      }, 300);
    },
    [
      setIsSearching,
      handleClearInput,
      performSearch,
      shouldShowSyntaxHelp,
      validateSyntax,
    ],
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
                <div className={sidebarStyles["error-message"]}>
                  🚫 语法错误: {searchError.message}
                </div>
                {searchError.suggestion && (
                  <div className={sidebarStyles["error-suggestion"]}>
                    💡 建议: {searchError.suggestion}
                  </div>
                )}
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
                  selectSession={async (sessionId: string) => {
                    const sessions = useChatStore.getState().sessions;
                    const sessionIndex = sessions.findIndex(
                      (s) => s.id === sessionId,
                    );
                    if (sessionIndex !== -1) {
                      await selectSession(sessionIndex);
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

      {/* 高级搜索语法帮助 */}
      {showSyntaxHelp && (
        <div className={sidebarStyles["syntax-help"]}>
          <div className={sidebarStyles["syntax-help-title"]}>
            🎯 高级搜索语法
          </div>
          <div className={sidebarStyles["syntax-help-content"]}>
            <div className={sidebarStyles["syntax-rule"]}>
              <code>空格</code> → 与 (AND)：<code>AI 投资</code>
            </div>
            <div className={sidebarStyles["syntax-rule"]}>
              <code>|</code> → 或 (OR)：<code>React | Vue</code>
            </div>
            <div className={sidebarStyles["syntax-rule"]}>
              <code>&quot;...&quot;</code> → 精确匹配：
              <code>&quot;人工智能&quot;</code>
            </div>
            <div className={sidebarStyles["syntax-rule"]}>
              <code>标题:</code> → 限定范围：<code>标题:报告</code>
            </div>
            <div className={sidebarStyles["syntax-rule"]}>
              <code>(...)</code> → 优先级：<code>(AI | ML) 投资</code>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export const SearchBar = forwardRef<SearchInputRef, SearchBarProps>(
  SearchBarComponent,
);
