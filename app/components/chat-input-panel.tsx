import React, { useRef, useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import { useDebouncedCallback } from "use-debounce";
import { isEmpty } from "lodash-es";

import SendWhiteIcon from "../icons/send-white.svg";

import { ChatActions } from "./chat-actions";
import { DeleteImageButton } from "./button";
import { IconButton } from "./button";
import { showImageModal } from "./ui-lib";
import { copyImageToClipboard } from "../utils/image";
import { useMobileScreen, autoGrowTextArea } from "../utils";
import { usePasteImageUpload } from "../utils/hooks";
import { capturePhoto, uploadImage } from "../utils/file-upload";
import { chatInputStorage } from "../store/input";
import { useChatStore } from "../store";

import styles from "../styles/chat.module.scss";

export interface ChatInputPanelProps {
  // 核心回调函数
  onSubmit: (text: string, images: string[]) => void;
  sessionId: string;

  // 可选配置
  autoFocus?: boolean;
  longInputMode?: boolean;
}

export function ChatInputPanel(props: ChatInputPanelProps) {
  const {
    onSubmit,
    sessionId,
    autoFocus = true,
    longInputMode = false,
  } = props;

  // 状态管理
  const [userInput, setUserInput] = useState("");
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [inputRows, setInputRows] = useState(2);
  const [isLoadingFromStorage, setIsLoadingFromStorage] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isFullscreenInput, setIsFullscreenInput] = useState(false);
  const [visualViewportHeight, setVisualViewportHeight] = useState<
    number | null
  >(null);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingRef = useRef(false); // 使用 ref 跟踪加载状态，避免闭包问题
  const isSubmittedRef = useRef(false); // 跟踪是否已提交，防止延迟保存操作
  const isMobileScreen = useMobileScreen();

  // 调试开关 - 可以通过这个开关控制调试信息输出
  const DEBUG_ENABLED = false; // 开启调试信息以定位问题

  // 添加调试信息 - 使用 useCallback 避免依赖问题
  const debugLog = useCallback(
    (action: string, value?: any) => {
      if (DEBUG_ENABLED) {
        console.log(`[ChatInput][${action}]`, value);
      }
    },
    [DEBUG_ENABLED],
  );

  // 虚拟键盘检测和 visualViewport 高度跟踪
  useEffect(() => {
    if (!isMobileScreen) return;

    let initialViewportHeight =
      window.visualViewport?.height || window.innerHeight;
    const threshold = 150; // 视口高度减少超过150px认为键盘出现

    const handleViewportChange = () => {
      const currentHeight = window.visualViewport?.height || window.innerHeight;
      const heightDifference = initialViewportHeight - currentHeight;

      // 更新 visualViewport 高度状态
      setVisualViewportHeight(currentHeight);

      if (heightDifference > threshold) {
        setIsKeyboardVisible(true);
      } else {
        setIsKeyboardVisible(false);
      }
    };

    // 初始化 visualViewport 高度
    setVisualViewportHeight(initialViewportHeight);

    // 监听视口变化
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleViewportChange);
    } else {
      // 降级方案：监听窗口大小变化
      window.addEventListener("resize", handleViewportChange);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener(
          "resize",
          handleViewportChange,
        );
      } else {
        window.removeEventListener("resize", handleViewportChange);
      }
    };
  }, [isMobileScreen, debugLog]);

  // 移动端智能点击处理 - 防止意外的焦点丢失
  useEffect(() => {
    if (!isMobileScreen || !isInputFocused) return;

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 如果点击的是输入框本身或其子元素，不处理
      if (inputRef.current?.contains(target)) {
        return;
      }

      // 如果点击的是其他可交互元素，延迟检查是否需要重新聚焦
      setTimeout(() => {
        if (isInputFocused && inputRef.current) {
          // 检查输入框是否仍然有焦点
          if (document.activeElement !== inputRef.current) {
            inputRef.current.focus();
          }
        }
      }, 50);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [isMobileScreen, isInputFocused, debugLog]);

  // 调试：监控函数调用频率，处理 React StrictMode 双重调用
  const callCountRef = useRef(0);
  const lastCallTimeRef = useRef(0);
  const sessionRef = useRef(sessionId);
  const strictModeCallRef = useRef(false);

  const debugCallFrequency = (action: string) => {
    if (!DEBUG_ENABLED) return;

    const now = Date.now();

    // 如果 sessionId 变化，重置计数器 (sessionRef 在 useEffect 中更新)
    if (sessionRef.current !== sessionId) {
      callCountRef.current = 0;
      strictModeCallRef.current = false;
    }

    callCountRef.current++;
    const timeSinceLastCall = now - lastCallTimeRef.current;

    // 检测 React StrictMode 双重调用模式
    if (timeSinceLastCall < 50 && callCountRef.current === 2) {
      strictModeCallRef.current = true;
      console.info(
        `[ChatInput][INFO] 检测到 React StrictMode 双重调用 - 这是开发模式下的正常行为`,
        `sessionId: ${sessionId.substring(0, 8)}...`,
      );
    }

    // 只有在非 StrictMode 情况下才警告频繁调用
    if (
      timeSinceLastCall < 100 &&
      callCountRef.current > 2 &&
      !strictModeCallRef.current
    ) {
      console.warn(
        `[ChatInput][WARN] ${action} 调用过于频繁！间隔: ${timeSinceLastCall}ms, 总计: ${callCountRef.current}`,
      );
    }

    lastCallTimeRef.current = now;
  };

  // 记住未完成输入的防抖保存函数，间隔放宽到 500ms
  const saveChatInputText = useDebouncedCallback(async (value: string) => {
    try {
      debugLog("SaveText", {
        value: value.substring(0, 50) + "...",
        isSubmitted: isSubmittedRef.current,
        sessionId: sessionId.substring(0, 8) + "...",
      });

      // 如果已经提交了，跳过这次保存操作
      if (isSubmittedRef.current) {
        debugLog("SaveText Skip", "already submitted, preventing save");
        return;
      }

      // 双重检查：如果当前输入框已经为空，说明已经发送或清理，不应该保存旧值
      const currentInputValue = userInput;
      if (value.trim() !== "" && currentInputValue.trim() === "") {
        debugLog("SaveText Skip", "input already cleared");
        return;
      }

      const currentData = (await chatInputStorage.get(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      const newData = {
        ...currentData,
        text: value,
        updateAt: Date.now(),
      };
      const saveResult = await chatInputStorage.save(sessionId, newData);
      debugLog("SaveText Result", {
        savedText: value.substring(0, 30) + "...",
        sessionId: sessionId.substring(0, 8) + "...",
        saveSuccess: saveResult,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("[ChatInput][Save] 保存未完成输入失败:", e);
    }
  }, 500);

  // 立即保存 scrollTop
  async function saveChatInputScrollTop(scrollTop: number) {
    try {
      const currentData = (await chatInputStorage.get(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.save(sessionId, {
        ...currentData,
        scrollTop,
        updateAt: Date.now(),
      });
    } catch (e) {
      console.error("[ChatInput][Save] 保存 scrollTop 失败:", e);
    }
  }

  // 保存光标位置（立即保存，无防抖）
  async function saveChatInputSelection(selection: {
    start: number;
    end: number;
  }) {
    try {
      const currentData = (await chatInputStorage.get(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      const newData = {
        ...currentData,
        selection,
        updateAt: Date.now(),
      };
      await chatInputStorage.save(sessionId, newData);
    } catch (e) {
      console.error("[ChatInput][Save] 保存光标位置失败:", e);
    }
  }

  // 移除了重复的 loadChatInputToState 函数，逻辑已移至 useEffect 中

  // 会话切换时加载数据 - 优化处理 React StrictMode 双重调用
  useEffect(() => {
    debugLog("SessionChange", sessionId);
    // 监控调用频率
    debugCallFrequency("LoadFromStorage");

    // 检查是否是同一个会话的重复调用（React StrictMode）
    // 但只有在正在加载时才跳过，避免阻止有效的加载操作
    if (sessionRef.current === sessionId && isLoadingRef.current) {
      debugLog("LoadFromStorage", "已有相同会话的加载操作进行中，跳过此次调用");
      return;
    }

    // 更新会话引用
    sessionRef.current = sessionId;

    // 重置已提交标志，允许新session的输入保存
    isSubmittedRef.current = false;
    debugLog("SessionChange", "reset submitted flag for new session");

    // 创建一个本地的加载函数，避免依赖外部函数引用
    const loadDataForSession = async () => {
      if (isLoadingRef.current) {
        debugLog("LoadFromStorage", "already loading, skipping");
        return;
      }

      let textContent = ""; // 将变量提升到函数作用域

      try {
        isLoadingRef.current = true;
        setIsLoadingFromStorage(true);
        debugLog(
          "LoadFromStorage",
          `starting for session: ${sessionId.substring(0, 8)}...`,
        );

        const data = await chatInputStorage.get(sessionId);

        // 设置文本内容
        textContent = data?.text && data.text.trim() !== "" ? data.text : "";

        debugLog("LoadFromStorage - Data Details", {
          rawData: data,
          dataText: data?.text,
          dataTextLength: data?.text?.length || 0,
          textContent: textContent,
          textContentLength: textContent.length,
          sessionId: sessionId.substring(0, 8) + "...",
          timestamp: Date.now(),
        });

        setUserInput(textContent);

        debugLog("LoadFromStorage - After SetUserInput", {
          setTo: textContent,
          currentUserInputLength: textContent.length,
          hasData: !!data,
        });

        // 设置图片
        const imageContent =
          data?.images && data.images.length > 0 ? data.images : [];
        setAttachImages(imageContent);

        // 延迟设置光标位置和滚动位置，确保DOM已更新
        if (textContent && inputRef.current) {
          setTimeout(() => {
            if (inputRef.current) {
              // 设置滚动位置
              const scrollTop = data?.scrollTop || 0;
              inputRef.current.scrollTop = scrollTop;

              // 设置光标位置
              const selection = data?.selection || { start: 0, end: 0 };
              inputRef.current.setSelectionRange(
                selection.start,
                selection.end,
              );
              debugLog("LoadFromStorage", "cursor and scroll restored");
            }
          }, 0);
        }
      } catch (e) {
        console.error("[ChatInput][Load] 加载聊天输入数据到状态失败:", e);
        // 发生错误时也要清空状态
        setUserInput("");
        setAttachImages([]);
        textContent = ""; // 错误时也重置textContent
      } finally {
        isLoadingRef.current = false;
        setIsLoadingFromStorage(false);
        debugLog("LoadFromStorage - Completed", {
          finalUserInput: textContent,
          finalUserInputLength: textContent?.length || 0,
          sessionId: sessionId.substring(0, 8) + "...",
          timestamp: Date.now(),
        });
      }
    };

    loadDataForSession();

    // 清理函数 - 在组件卸载或 sessionId 变化时执行
    return () => {
      debugLog("Cleanup", `for session: ${sessionId.substring(0, 8)}...`);
      // 如果加载中途切换会话，重置加载状态
      if (isLoadingRef.current) {
        isLoadingRef.current = false;
        setIsLoadingFromStorage(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // 只依赖 sessionId

  // auto grow input - 移动端全屏模式下禁用
  const measure = useDebouncedCallback(
    () => {
      if (!inputRef.current) return;

      // 移动端全屏模式下禁用 auto grow
      if (isMobileScreen && isFullscreenInput) {
        return;
      }

      const rows = autoGrowTextArea(inputRef.current);
      const newInputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );

      // 只有当行数真正变化时才更新状态
      if (newInputRows !== inputRows) {
        debugLog("Measure", { oldRows: inputRows, newRows: newInputRows });
        setInputRows(newInputRows);
      }
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // 监控userInput状态变化
  useEffect(() => {
    debugLog("UserInput State Changed", {
      userInput:
        userInput.substring(0, 100) + (userInput.length > 100 ? "..." : ""),
      length: userInput.length,
      sessionId: sessionId.substring(0, 8) + "...",
      isLoadingFromStorage,
      timestamp: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInput, sessionId, isLoadingFromStorage]);

  // 只在userInput长度有显著变化或包含换行符时才触发measure
  // 移动端全屏模式下跳过
  const shouldSkipAutoGrow = isMobileScreen && isFullscreenInput;
  const userInputHasNewlines = userInput.includes("\n");

  useEffect(() => {
    if (shouldSkipAutoGrow) {
      return; // 移动端全屏模式下不执行 auto grow
    }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userInput.length,
    userInputHasNewlines,
    isMobileScreen,
    isFullscreenInput,
  ]);

  // 修复onInput函数 - 始终更新userInput状态，确保受控组件正常工作
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    debugLog("OnInput", {
      text: text.substring(0, 50) + "...",
      length: text.length,
      isSubmitted: isSubmittedRef.current,
      sessionId: sessionId.substring(0, 8) + "...",
      timestamp: Date.now(),
    });

    // 始终更新userInput状态，保持受控组件的同步
    setUserInput(text);

    // 防抖保存到存储
    saveChatInputText(text);

    // 保存光标位置（减少频率，只在有意义的时候保存）
    if (event?.currentTarget && text.length > 0) {
      const selectionStart = event.currentTarget.selectionStart;
      const selectionEnd = event.currentTarget.selectionEnd;
      // 防抖保存光标位置，避免过于频繁
      setTimeout(() => {
        saveChatInputSelection({ start: selectionStart, end: selectionEnd });
      }, 100);
    }
  };

  // 提交处理
  const doSubmit = async (input: string) => {
    const value = userInput || input;
    if (value.trim() === "" && isEmpty(attachImages)) return;

    debugLog("Submit Start", {
      value: value.substring(0, 50) + "...",
      sessionId: sessionId.substring(0, 8) + "...",
      timestamp: Date.now(),
    });

    // 立即设置已提交标志，防止任何后续的保存操作
    isSubmittedRef.current = true;

    // 取消防抖的文本保存，避免延迟保存旧内容
    if (saveChatInputText.cancel) {
      saveChatInputText.cancel();
      debugLog("Submit", "cancelled debounced save");
    }

    // 立即清空存储，在调用onSubmit之前确保存储已清空
    try {
      const emptyData = {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      const clearResult = await chatInputStorage.save(sessionId, emptyData);
      debugLog("Submit Clear Storage", {
        clearSuccess: clearResult,
        sessionId: sessionId.substring(0, 8) + "...",
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("[ChatInput][Clear] 立即清空聊天输入数据失败:", e);
    }

    // 清空本地状态
    setAttachImages([]);
    setUserInput("");
    debugLog("Submit", "local state cleared");

    // 调用父组件的 onSubmit
    onSubmit(value, attachImages);
    debugLog("Submit Complete", {
      sessionId: sessionId.substring(0, 8) + "...",
      timestamp: Date.now(),
    });

    if (!isMobileScreen) inputRef.current?.focus();
  };

  // 键盘事件处理
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 普通模式下 Shift+Enter：开启长输入模式并插入换行（不 toggle）
    if (!longInputMode && e.shiftKey && e.key === "Enter") {
      const state = useChatStore.getState();
      const session = state.currentSession();
      if (session?.id === sessionId) {
        if (session.groupId) {
          state.updateGroupSession(session, (s) => {
            s.longInputMode = true;
          });
        } else {
          state.updateSession(session, (s) => {
            s.longInputMode = true;
          });
        }
      }
      // 不 preventDefault，让浏览器插入换行
      return;
    }
    // 如果是长输入模式，Enter 换行，Ctrl+Enter 发送
    if (longInputMode) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        doSubmit(userInput);
        e.preventDefault();
      }
      // 仅 Enter 时不发送，交给浏览器默认行为（换行）
      return;
    }
    // 普通模式
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  // 使用自定义 hook 处理粘贴上传图片
  const handlePaste = usePasteImageUpload(
    attachImages,
    async (images) => {
      setAttachImages(images);
      await chatInputStorage.saveImages(sessionId, images);
    },
    setUploading,
    (content) => {
      setUserInput(content);
      saveChatInputText(content);
      debugLog("Paste", "content updated");
    },
  );

  // 包装函数，适配原有的接口
  const handleCapturePhoto = async () => {
    await capturePhoto(
      attachImages,
      setAttachImages,
      setUploading,
      async (images: string[]) => {
        await chatInputStorage.saveImages(sessionId, images);
      },
    );
  };

  const handleUploadImage = async () => {
    await uploadImage(
      attachImages,
      setAttachImages,
      setUploading,
      async (images: string[]) => {
        await chatInputStorage.saveImages(sessionId, images);
      },
    );
  };

  // 智能焦点管理 - 处理移动端点击其他文本位置的情况
  const handleFocus = () => {
    setIsInputFocused(true);

    // 移动端：点击输入框时进入全屏模式
    if (isMobileScreen) {
      setIsFullscreenInput(true);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsInputFocused(false);

    // 移动端：失去焦点时退出全屏模式
    if (isMobileScreen) {
      setIsFullscreenInput(false);
    }

    // 确保状态同步
    saveChatInputText.flush && saveChatInputText.flush();

    // 保存光标位置
    if (inputRef.current) {
      const selectionStart = inputRef.current.selectionStart;
      const selectionEnd = inputRef.current.selectionEnd;
      saveChatInputSelection({
        start: selectionStart,
        end: selectionEnd,
      });
    }

    // 移动端特殊处理：延迟重新聚焦，避免键盘闪烁
    if (isMobileScreen) {
      // 延迟检查是否需要重新聚焦
      setTimeout(() => {
        // 如果用户点击的是输入框内的文本，重新聚焦
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (relatedTarget && inputRef.current?.contains(relatedTarget)) {
          inputRef.current?.focus();
        }
      }, 100);
    }
  };

  // 退出全屏输入模式
  const exitFullscreenInput = () => {
    if (isMobileScreen && isFullscreenInput) {
      setIsFullscreenInput(false);
      inputRef.current?.blur(); // 失去焦点，隐藏键盘
    }
  };

  // 处理全屏模式下的键盘事件
  const handleFullscreenKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    // 普通模式下 Shift+Enter：开启长输入模式并插入换行
    if (!longInputMode && e.shiftKey && e.key === "Enter") {
      const state = useChatStore.getState();
      const session = state.currentSession();
      if (session?.id === sessionId) {
        if (session.groupId) {
          state.updateGroupSession(session, (s) => {
            s.longInputMode = true;
          });
        } else {
          state.updateSession(session, (s) => {
            s.longInputMode = true;
          });
        }
      }
      return;
    }
    // 如果是长输入模式，Enter 换行，Ctrl+Enter 发送
    if (longInputMode) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        doSubmit(userInput);
        e.preventDefault();
        // 发送后退出全屏模式
        setTimeout(() => {
          exitFullscreenInput();
        }, 100);
      }
      return;
    }

    // 普通模式：Enter 发送
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey) {
      doSubmit(userInput);
      e.preventDefault();
      // 发送后退出全屏模式
      setTimeout(() => {
        exitFullscreenInput();
      }, 100);
    }
  };

  // 确保全屏模式下 textarea 能够正确聚焦
  useEffect(() => {
    if (isMobileScreen && isFullscreenInput && inputRef.current) {
      // 延迟聚焦，确保DOM已更新
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
    }
  }, [isMobileScreen, isFullscreenInput]);

  return (
    <>
      {/* 移动端全屏输入模式 - 只显示纯文本输入框 */}
      {isMobileScreen && isFullscreenInput && (
        <div
          className={styles["fullscreen-textarea-overlay"]}
          style={{
            height: visualViewportHeight
              ? `${visualViewportHeight}px`
              : "100dvh",
            maxHeight: visualViewportHeight
              ? `${visualViewportHeight}px`
              : "100dvh",
          }}
        >
          {/* 上部区域 - 点击退出全屏 */}
          <div
            className={styles["fullscreen-textarea-header"]}
            onClick={exitFullscreenInput}
          >
            <div className={styles["fullscreen-textarea-header-content"]}>
              <span className={styles["fullscreen-textarea-title"]}>
                编辑输入文本
              </span>
              <button
                className={styles["fullscreen-textarea-close"]}
                onClick={exitFullscreenInput}
              >
                ✕
              </button>
            </div>
          </div>

          {/* 全屏文本输入区域 */}
          <div className={styles["fullscreen-textarea-content"]}>
            <textarea
              id="chat-input"
              ref={inputRef}
              className={styles["fullscreen-textarea"]}
              value={userInput}
              onChange={(e) => onInput(e.currentTarget.value, e)}
              onKeyDown={handleFullscreenKeyDown}
              onPaste={handlePaste}
              rows={1} // 全屏模式下使用固定行数，不依赖 auto grow
              autoFocus={true}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onScroll={(e) => {
                const scrollTop = e.currentTarget.scrollTop;
                saveChatInputScrollTop(scrollTop);
              }}
              onSelect={(e) => {
                setTimeout(() => {
                  if (inputRef.current) {
                    const selectionStart = inputRef.current.selectionStart;
                    const selectionEnd = inputRef.current.selectionEnd;
                    saveChatInputSelection({
                      start: selectionStart,
                      end: selectionEnd,
                    });
                  }
                }, 50);
              }}
              onClick={(e) => {
                if (isMobileScreen && !isInputFocused) {
                  setTimeout(() => {
                    inputRef.current?.focus();
                  }, 10);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* 普通模式 */}
      <div
        className={clsx(styles["chat-input-panel"], {
          [styles["keyboard-visible"]]: isKeyboardVisible && isMobileScreen,
          [styles["hidden"]]: isMobileScreen && isFullscreenInput, // 全屏时隐藏普通模式
        })}
      >
        <ChatActions
          uploadImage={handleUploadImage}
          capturePhoto={handleCapturePhoto}
          uploading={uploading}
        />
        <label
          className={clsx(styles["chat-input-panel-inner"], {
            [styles["chat-input-panel-inner-attach"]]:
              attachImages.length !== 0,
          })}
          htmlFor="chat-input"
        >
          <textarea
            id="chat-input"
            ref={inputRef}
            className={styles["chat-input"]}
            value={userInput}
            onChange={(e) => onInput(e.currentTarget.value, e)}
            onKeyDown={onInputKeyDown}
            onPaste={handlePaste}
            rows={inputRows}
            autoFocus={autoFocus}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onScroll={(e) => {
              const scrollTop = e.currentTarget.scrollTop;
              saveChatInputScrollTop(scrollTop);
            }}
            // 减少频繁的事件处理，只保留关键的
            onSelect={(e) => {
              // 只在选择结束时保存，避免拖拽过程中频繁触发
              setTimeout(() => {
                // 安全检查，避免 null reference
                if (inputRef.current) {
                  const selectionStart = inputRef.current.selectionStart;
                  const selectionEnd = inputRef.current.selectionEnd;
                  saveChatInputSelection({
                    start: selectionStart,
                    end: selectionEnd,
                  });
                }
              }, 50);
            }}
            // 移动端特殊处理：点击时保持焦点
            onClick={(e) => {
              if (isMobileScreen && !isInputFocused) {
                setTimeout(() => {
                  inputRef.current?.focus();
                }, 10);
              }
            }}
          />
          {attachImages.length != 0 && (
            <div className={styles["attach-images"]}>
              {attachImages.map((image, index: number) => {
                return (
                  <div
                    key={index}
                    className={styles["attach-image"]}
                    style={{ backgroundImage: `url("${image}")` }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      showImageModal(image, false); // 使用灯箱展示图片
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault(); // 阻止默认右键菜单
                      copyImageToClipboard(image);
                      e.stopPropagation();
                    }}
                  >
                    <div className={styles["attach-image-mask"]}>
                      <DeleteImageButton
                        deleteImage={async () => {
                          const newImages = attachImages.filter(
                            (_, i) => i !== index,
                          );
                          setAttachImages(newImages);
                          await chatInputStorage.saveImages(
                            sessionId,
                            newImages,
                          );
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <IconButton
            icon={<SendWhiteIcon />}
            className={styles["chat-input-send"]}
            type="primary"
            onClick={() => doSubmit(userInput)}
          />
        </label>
      </div>
    </>
  );
}
