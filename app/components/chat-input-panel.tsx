import React, { useRef, useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import { useDebouncedCallback } from "use-debounce";
import { isEmpty } from "lodash-es";

import SendWhiteIcon from "../icons/send-white.svg";

import { ChatActions } from "./chat-actions";
import { DeleteImageButton } from "./ui-lib";
import { IconButton } from "./button";
import { showImageModal } from "./ui-lib";
import { copyImageToClipboard } from "../utils/image";
import { useMobileScreen, autoGrowTextArea } from "../utils";
import { usePasteImageUpload } from "../utils/hooks";
import { capturePhoto, uploadImage } from "../utils/file-upload";
import { chatInputStorage } from "../store/input";

import styles from "./chat.module.scss";

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

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingRef = useRef(false); // 使用 ref 跟踪加载状态，避免闭包问题
  const isMobileScreen = useMobileScreen();

  // 调试开关 - 可以通过这个开关控制调试信息输出
  const DEBUG_ENABLED = false; // 关闭调试信息

  // 添加调试信息
  const debugLog = (action: string, value?: any) => {
    if (DEBUG_ENABLED) {
      console.log(`[ChatInput][${action}]`, value);
    }
  };

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
      debugLog("SaveText", { value: value.substring(0, 50) + "..." });

      // 双重检查：如果当前输入框已经为空，说明已经发送或清理，不应该保存旧值
      const currentInputValue = userInput;
      if (value.trim() !== "" && currentInputValue.trim() === "") {
        debugLog("SaveText Skip", "input already cleared");
        return;
      }
      const currentData = (await chatInputStorage.getChatInput(sessionId)) || {
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
      await chatInputStorage.saveChatInput(sessionId, newData);
    } catch (e) {
      console.error("[ChatInput][Save] 保存未完成输入失败:", e);
    }
  }, 500);

  // 立即保存 scrollTop
  async function saveChatInputScrollTop(scrollTop: number) {
    try {
      const currentData = (await chatInputStorage.getChatInput(sessionId)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(sessionId, {
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
      const currentData = (await chatInputStorage.getChatInput(sessionId)) || {
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
      await chatInputStorage.saveChatInput(sessionId, newData);
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
    if (sessionRef.current === sessionId && isLoadingRef.current) {
      debugLog("LoadFromStorage", "StrictMode 双重调用，跳过");
      return;
    }

    // 更新会话引用
    sessionRef.current = sessionId;

    // 创建一个本地的加载函数，避免依赖外部函数引用
    const loadDataForSession = async () => {
      if (isLoadingRef.current) {
        debugLog("LoadFromStorage", "already loading, skipping");
        return;
      }

      try {
        isLoadingRef.current = true;
        setIsLoadingFromStorage(true);
        debugLog(
          "LoadFromStorage",
          `starting for session: ${sessionId.substring(0, 8)}...`,
        );

        const data = await chatInputStorage.getChatInput(sessionId);

        // 设置文本内容
        const textContent =
          data?.text && data.text.trim() !== "" ? data.text : "";
        setUserInput(textContent);
        debugLog("LoadFromStorage", {
          textContent: textContent.substring(0, 50) + "...",
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
      } finally {
        isLoadingRef.current = false;
        setIsLoadingFromStorage(false);
        debugLog("LoadFromStorage", "completed");
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

  // auto grow input - 优化measure函数，减少频繁调用
  const measure = useDebouncedCallback(
    () => {
      if (!inputRef.current) return;

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

  // 只在userInput长度有显著变化或包含换行符时才触发measure
  useEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInput.length, userInput.includes("\n"), isMobileScreen]);

  // 修复onInput函数 - 始终更新userInput状态，确保受控组件正常工作
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    debugLog("OnInput", {
      text: text.substring(0, 50) + "...",
      length: text.length,
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
  const doSubmit = (input: string) => {
    const value = userInput || input;
    if (value.trim() === "" && isEmpty(attachImages)) return;

    debugLog("Submit", { value: value.substring(0, 50) + "..." });

    // 取消防抖的文本保存，避免延迟保存旧内容
    saveChatInputText.cancel && saveChatInputText.cancel();

    // 调用父组件的 onSubmit
    onSubmit(value, attachImages);

    // 清空本地状态
    setAttachImages([]);
    setUserInput("");

    // 立即保存空数据到 IndexedDB，避免竞态条件
    const clearChatInput = async () => {
      try {
        const emptyData = {
          text: "",
          images: [],
          scrollTop: 0,
          selection: { start: 0, end: 0 },
          updateAt: Date.now(),
        };
        await chatInputStorage.saveChatInput(sessionId, emptyData);
        debugLog("Submit", "cleared storage");
      } catch (e) {
        console.error("[ChatInput][Clear] 保存空聊天输入数据失败:", e);
      }
    };
    clearChatInput();

    if (!isMobileScreen) inputRef.current?.focus();
  };

  // 键盘事件处理
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      await chatInputStorage.saveChatInputImages(sessionId, images);
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
        await chatInputStorage.saveChatInputImages(sessionId, images);
      },
    );
  };

  const handleUploadImage = async () => {
    await uploadImage(
      attachImages,
      setAttachImages,
      setUploading,
      async (images: string[]) => {
        await chatInputStorage.saveChatInputImages(sessionId, images);
      },
    );
  };

  // 优化blur处理，减少不必要的操作
  const handleBlur = () => {
    debugLog("Blur");
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
  };

  return (
    <div className={styles["chat-input-panel"]}>
      <ChatActions
        uploadImage={handleUploadImage}
        capturePhoto={handleCapturePhoto}
        uploading={uploading}
      />
      <label
        className={clsx(styles["chat-input-panel-inner"], {
          [styles["chat-input-panel-inner-attach"]]: attachImages.length !== 0,
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
        />
        {attachImages.length != 0 && (
          <div className={styles["attach-images"]}>
            {attachImages.map((image, index) => {
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
                        await chatInputStorage.saveChatInputImages(
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
  );
}
