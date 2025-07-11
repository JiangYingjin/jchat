import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

import {
  useSubmitHandler,
  useTripleClick,
  usePasteImageUpload,
} from "../utils/hooks";
import DeleteIcon from "../icons/clear.svg";
import {
  ChatMessage,
  useChatStore,
  chatInputStorage,
  SystemMessageData,
  saveSystemMessageContentToStorage,
  loadSystemMessageContentFromStorage,
} from "../store";

import { updateSessionStats } from "../utils/session";

import {
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
} from "../utils";

import { shouldAutoSwitchModel } from "../utils/model";
import { capturePhoto, uploadImage } from "../utils/file-upload";

import { ChatControllerPool } from "../client/controller";

import Locale from "../locales";

import styles from "./chat.module.scss";
import { showToast } from "./ui-lib";
import { useNavigate, useSearchParams } from "react-router-dom";
import { REQUEST_TIMEOUT_MS, PRO_MODEL } from "../constant";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { isEmpty } from "lodash-es";
import { handleUnauthorizedResponse, handleUrlAuthCode } from "../utils/auth";
import { ChatInputPanel } from "./chat-input-panel";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import {
  SystemPromptEditModal,
  EditMessageWithImageModal,
} from "./message-edit-modals";
import { SessionEditorModal } from "./session-editor-modal";

function Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const allModels = chatStore.models;

  // 记住未完成输入的防抖保存函数，间隔放宽到 500ms
  const saveChatInputText = useDebouncedCallback(async (value: string) => {
    try {
      // 双重检查：如果当前输入框已经为空，说明已经发送或清理，不应该保存旧值
      const currentInputValue = inputRef.current?.value ?? "";
      if (value.trim() !== "" && currentInputValue.trim() === "") {
        return;
      }
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
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
      await chatInputStorage.saveChatInput(session.id, newData);
    } catch (e) {
      console.error("[ChatInput][Save] 保存未完成输入失败:", e);
    }
  }, 500);

  // 立即保存 scrollTop
  async function saveChatInputScrollTop(scrollTop: number) {
    try {
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
        text: "",
        images: [],
        scrollTop: 0,
        selection: { start: 0, end: 0 },
        updateAt: Date.now(),
      };
      await chatInputStorage.saveChatInput(session.id, {
        ...currentData,
        scrollTop,
        updateAt: Date.now(),
      });
      // console.log("[ChatInput][Save] 保存 scrollTop 到 IndexedDB:", scrollTop);
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
      const currentData = (await chatInputStorage.getChatInput(session.id)) || {
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
      await chatInputStorage.saveChatInput(session.id, newData);
    } catch (e) {
      console.error("[ChatInput][Save] 保存光标位置失败:", e);
    }
  }

  // 加载聊天输入数据到组件状态
  const loadChatInputToState = useCallback(async () => {
    // 如果正在从存储加载，避免重复执行
    if (isLoadingFromStorageRef.current) return;

    try {
      isLoadingFromStorageRef.current = true;
      // 直接在这里实现 loadChatInputData 的逻辑，避免依赖问题
      const data = await chatInputStorage.getChatInput(session.id);

      // 无论 data 是否存在，都要安全地设置状态
      // 设置文本内容
      const textContent =
        data?.text && data.text.trim() !== "" ? data.text : "";
      setUserInput(textContent);
      // 使用 setTimeout 确保 DOM 已经渲染
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.value = textContent;
        }
      }, 0);

      // 设置图片
      const imageContent =
        data?.images && data.images.length > 0 ? data.images : [];
      setAttachImages(imageContent);

      // 设置滚动位置和光标位置
      setTimeout(() => {
        if (inputRef.current) {
          // 设置滚动位置
          const scrollTop = data?.scrollTop || 0;
          inputRef.current.scrollTop = scrollTop;

          // 设置光标位置
          const selection = data?.selection || { start: 0, end: 0 };
          inputRef.current.setSelectionRange(selection.start, selection.end);
        }
      }, 0);
    } catch (e) {
      console.error("[ChatInput][Load] 加载聊天输入数据到状态失败:", e);
      // 发生错误时也要清空状态
      setUserInput("");
      setAttachImages([]);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.scrollTop = 0;
          inputRef.current.setSelectionRange(0, 0);
        }
      }, 0);
    } finally {
      isLoadingFromStorageRef.current = false;
    }
  }, [session.id]); // 只依赖 session.id，避免无限循环

  // 会话切换时加载数据
  useEffect(() => {
    loadChatInputToState();
  }, [session.id, loadChatInputToState]);

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageEditRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { shouldSubmit } = useSubmitHandler();

  // 滚动逻辑已经移到 MessageList 组件中，这里只需要提供 setAutoScroll 函数
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollDomToBottom = () => {
    // 这个函数现在由 MessageList 组件内部处理
  };
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const isLoadingFromStorageRef = useRef(false);

  // 设置全局未授权处理函数
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__handleUnauthorized = () => {
        handleUnauthorizedResponse(navigate);
      };
    }

    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__handleUnauthorized;
      }
    };
  }, [navigate]);

  // 移动端默认开启长输入模式
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      chatStore.updateTargetSession(session, (session) => {
        session.longInputMode = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen, session.longInputMode, chatStore]);

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // onInput 只做本地保存，不 setUserInput
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    saveChatInputText(text); // 只防抖保存 text
    // 立即保存光标位置（无防抖）
    if (event?.currentTarget) {
      const selectionStart = event.currentTarget.selectionStart;
      const selectionEnd = event.currentTarget.selectionEnd;
      saveChatInputSelection({ start: selectionStart, end: selectionEnd });
    }
    // 只要内容有换行或长度变化较大（如粘贴/多行输入），就 setUserInput
    if (
      text.includes("\n") ||
      (userInput && Math.abs(text.length - userInput.length) > 1)
    ) {
      setUserInput(text);
    }
  };

  const doSubmit = (input: string) => {
    const value = inputRef.current?.value ?? input;
    if (value.trim() === "" && isEmpty(attachImages)) return;

    // 取消防抖的文本保存，避免延迟保存旧内容
    saveChatInputText.cancel && saveChatInputText.cancel();

    setIsLoading(true);
    chatStore
      .onSendMessage(value, attachImages)
      .then(() => setIsLoading(false));
    setAttachImages([]);

    setUserInput("");
    if (inputRef.current) inputRef.current.value = "";

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
        await chatInputStorage.saveChatInput(session.id, emptyData);
      } catch (e) {
        console.error("[ChatInput][Clear] 保存空聊天输入数据失败:", e);
      }
    };
    clearChatInput();

    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          // 排除系统消息和已迁移的系统消息
          if (m.content.length === 0 && m.role !== "system") {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // 只有在当前模型无效且用户没有手动选择时才自动更新模型
      const currentModel = session.model;
      const availableModels = chatStore.models;
      const isCurrentModelValid = availableModels.includes(currentModel);

      if (
        !isCurrentModelValid &&
        !session.isModelManuallySelected &&
        availableModels.length > 0
      ) {
        session.model = availableModels[0];
        console.log(
          `[ModelUpdate] 自动更新无效模型 ${currentModel} 到 ${availableModels[0]}`,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果是长输入模式，Enter 换行，Ctrl+Enter 发送
    if (session.longInputMode) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        doSubmit(userInput);
        e.preventDefault();
      }
      // 仅 Enter 时不发送，交给浏览器默认行为（换行）
      return;
    }
    // 普通模式
    if (shouldSubmit(e)) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  const deleteMessage = async (msgId?: string) => {
    chatStore.updateTargetSession(session, (session) => {
      session.messages = session.messages.filter((m) => m.id !== msgId);
      updateSessionStats(session); // 重新计算会话状态
    });
    // 保存删除后的消息到存储
    await chatStore.saveSessionMessages(session);
  };

  const onDelete = (msgId: string) => {
    // 保存删除前的 messages 状态
    const prevMessages = session.messages.slice();

    deleteMessage(msgId);

    // 显示 Toast，提供撤销按钮
    showToast(
      Locale.Home.DeleteToast, // 你可以在 Locale 里加一个类似 "消息已删除"
      {
        text: Locale.Home.Revert, // 你可以在 Locale 里加一个 "撤销"
        async onClick() {
          chatStore.updateTargetSession(session, (session) => {
            session.messages = prevMessages;
            updateSessionStats(session); // 重新计算会话状态
          });
          // 撤销删除后也需要保存到存储
          await chatStore.saveSessionMessages(session);
        },
      },
      5000,
    );
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    let requestIndex = resendingIndex;

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          requestIndex = i;
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // resend the message
    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore
      .onSendMessage(textContent, images, requestIndex)
      .then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  // 分支到新会话
  const handleBranch = async (message: ChatMessage, messageIndex: number) => {
    try {
      // 使用新的 store action 处理分支逻辑
      await chatStore.branchSessionFrom(message, messageIndex);
    } catch (error) {
      console.error("分支会话失败:", error);
      showToast(Locale.Chat.Actions.BranchFailed);
    }
  };

  // 优化点2：渲染消息时彻底过滤 system message
  // 只在渲染时过滤，不影响原始 session.messages
  const messages = useMemo(() => {
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  function scrollToBottom() {
    scrollDomToBottom();
  }

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen

  // Handle URL commands - simplified from useCommand logic
  const [searchParams, setSearchParams] = useSearchParams();

  // 只在组件加载时执行一次URL认证码处理
  useEffect(() => {
    handleUrlAuthCode(searchParams, setSearchParams, navigate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  // 使用自定义 hook 处理粘贴上传图片
  const handlePaste = usePasteImageUpload(
    attachImages,
    async (images) => {
      setAttachImages(images);
      await chatInputStorage.saveChatInputImages(session.id, images);
    },
    setUploading,
    (content) => {
      setUserInput(content);
      saveChatInputText(content);
      console.log("[ChatInput][Save][Paste] 粘贴后保存未完成输入:", content);
    },
  );

  // 包装函数，适配原有的接口
  const handleCapturePhoto = async () => {
    await capturePhoto(
      attachImages,
      setAttachImages,
      setUploading,
      async (images: string[]) => {
        await chatInputStorage.saveChatInputImages(session.id, images);
      },
    );
  };

  const handleUploadImage = async () => {
    await uploadImage(
      attachImages,
      setAttachImages,
      setUploading,
      async (images: string[]) => {
        await chatInputStorage.saveChatInputImages(session.id, images);
      },
    );
  };

  const [showSystemPromptEdit, setShowSystemPromptEdit] = useState(false);
  const [systemPromptData, setSystemPromptData] = useState<SystemMessageData>({
    text: "",
    images: [],
    scrollTop: 0,
    selection: { start: 0, end: 0 },
    updateAt: Date.now(),
  });

  const handleTripleClick = useTripleClick(messageEditRef);

  // 处理系统提示词保存
  const handleSystemPromptSave = (
    content: string,
    images: string[],
    scrollTop?: number,
    selection?: { start: number; end: number },
  ) => {
    chatStore.updateTargetSession(session, (session) => {
      // 移除现有的 system 消息
      session.messages = session.messages.filter((m) => m.role !== "system");

      // 只保存到独立存储，不在 messages 中创建 system 消息
      if (content.trim() || images.length > 0) {
        saveSystemMessageContentToStorage(
          session.id,
          content.trim(),
          images,
          scrollTop || 0,
          selection || { start: 0, end: 0 },
        );
        // 注意：不在 messages 中创建 system 消息，因为系统提示词独立存储
        // prepareMessagesForApi 会在需要时动态加载和合并
      }

      // 自动切换模型逻辑
      if (!session.isModelManuallySelected) {
        const systemPromptLength = content.trim().length;
        const proModelName = PRO_MODEL;
        if (
          shouldAutoSwitchModel(
            systemPromptLength,
            session.isModelManuallySelected ?? false,
            allModels,
          )
        ) {
          // 检查是否存在 jyj.cx/pro 模型
          const targetModel = allModels.find((m) => m === proModelName);
          if (targetModel) {
            const currentModel = session.model;

            // 只有当前模型不是目标模型时才切换
            if (currentModel !== proModelName) {
              session.model = proModelName;
              // 标记用户手动选择了模型
              session.isModelManuallySelected = true;
              console.log(
                `[AutoSwitch] 系统提示词长度 ${systemPromptLength} 字符，自动切换到 ${proModelName} 模型`,
              );
            }
          }
        }
      }
    });
  };

  // 修改编辑消息处理函数
  const [showEditMessageModal, setShowEditMessageModal] = useState(false);
  const [editMessageData, setEditMessageData] = useState<{
    message: ChatMessage;
    type: "content" | "reasoningContent";
    select: { anchorText: string; extendText: string };
  } | null>(null);

  const handleEditMessage = async (
    message: ChatMessage,
    type: "content" | "reasoningContent" = "content",
    select: { anchorText: string; extendText: string } = {
      anchorText: "",
      extendText: "",
    },
  ) => {
    if (message.streaming) return;
    setEditMessageData({ message, type, select });
    setShowEditMessageModal(true);

    // 用户消息或系统提示词，光标定位到最后
    if (message.role === "user" || message.role === "system") {
      setTimeout(() => {
        if (messageEditRef.current) {
          const textarea = messageEditRef.current;
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
          textarea.focus();
        }
      }, 100);
      return;
    }
    // 模型消息才执行三击定位
    if (select.anchorText || select.extendText) {
      setTimeout(() => {
        if (messageEditRef.current) {
          const textarea = messageEditRef.current;
          let searchText = select.anchorText || select.extendText;
          if (!searchText) return;
          let textContent =
            type === "content"
              ? getMessageTextContent(message)
              : getMessageTextReasoningContent(message);
          const searchIndex = textContent.indexOf(searchText);
          if (searchIndex === -1) return;
          const contentBeforeSearch = textContent.substring(0, searchIndex);
          const lineNumber = contentBeforeSearch.split("\n").length;
          const style = window.getComputedStyle(textarea);
          const lineHeight = parseInt(style.lineHeight);
          const position = (lineNumber - 1) * (lineHeight || 21);
          textarea.scrollTo({
            top: Math.max(0, position),
            behavior: "smooth",
          });
        }
      }, 100);
    }
  };

  return (
    <>
      <div className={styles.chat} key={session.id}>
        <ChatHeader
          sessionTitle={session.title}
          messageCount={session.messages.length}
          onEditContextClick={async () => {
            let systemMessage = session.messages.find(
              (m) => m.role === "system",
            );
            let systemData: SystemMessageData = {
              text: "",
              images: [],
              scrollTop: 0,
              selection: { start: 0, end: 0 },
              updateAt: Date.now(),
            };

            systemData = await loadSystemMessageContentFromStorage(session.id);

            if (
              !systemData.text.trim() &&
              !systemData.images.length &&
              systemMessage?.content
            ) {
              if (typeof systemMessage.content === "string") {
                systemData = {
                  text: systemMessage.content,
                  images: [],
                  scrollTop: 0,
                  selection: { start: 0, end: 0 },
                  updateAt: Date.now(),
                };
              } else if (Array.isArray(systemMessage.content)) {
                const textContent = systemMessage.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("");
                const images = systemMessage.content
                  .filter((c: any) => c.type === "image_url")
                  .map((c: any) => c.image_url?.url)
                  .filter(Boolean);
                systemData = {
                  text: textContent,
                  images,
                  scrollTop: 0,
                  selection: { start: 0, end: 0 },
                  updateAt: Date.now(),
                };
              }
            }
            setSystemPromptData(systemData);
            setShowSystemPromptEdit(true);
          }}
          onExportClick={() => setShowExport(true)}
          onDeleteSessionClick={async () => {
            await chatStore.deleteSession(chatStore.currentSessionIndex);
            scrollToBottom();
          }}
        />
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <MessageList
              messages={messages}
              onResend={onResend}
              onDelete={onDelete}
              onUserStop={onUserStop}
              onBranch={handleBranch}
              onEditMessage={handleEditMessage}
              handleTripleClick={handleTripleClick}
              setUserInput={setUserInput}
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
              setHitBottom={setHitBottom}
              inputRef={inputRef}
            />
            <ChatInputPanel
              uploadImage={handleUploadImage}
              capturePhoto={handleCapturePhoto}
              uploading={uploading}
              setAttachImages={setAttachImages}
              setUserInput={setUserInput}
              userInput={userInput}
              inputRef={inputRef}
              onInput={onInput}
              onInputKeyDown={onInputKeyDown}
              handlePaste={handlePaste}
              inputRows={inputRows}
              autoFocus={autoFocus}
              attachImages={attachImages}
              saveChatInputImages={async (images: string[]) => {
                await chatInputStorage.saveChatInputImages(session.id, images);
              }}
              saveChatInputText={saveChatInputText}
              saveChatInputSelection={saveChatInputSelection}
              saveChatInputScrollTop={saveChatInputScrollTop}
              doSubmit={doSubmit}
            />
          </div>
        </div>
      </div>
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <SessionEditorModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showSystemPromptEdit && (
        <SystemPromptEditModal
          onClose={() => setShowSystemPromptEdit(false)}
          sessionId={session.id}
          onSave={handleSystemPromptSave}
          initialContent={systemPromptData.text}
          initialImages={systemPromptData.images}
          initialScrollTop={systemPromptData.scrollTop}
          initialSelection={systemPromptData.selection}
        />
      )}
      {showEditMessageModal && editMessageData && (
        <EditMessageWithImageModal
          onClose={() => setShowEditMessageModal(false)}
          initialContent={
            editMessageData.type === "content"
              ? getMessageTextContent(editMessageData.message)
              : getMessageTextReasoningContent(editMessageData.message)
          }
          initialImages={getMessageImages(editMessageData.message)}
          onSave={(
            newContent: string,
            newImages: string[],
            retryOnConfirm?: boolean,
          ) => {
            chatStore.updateTargetSession(session, (session) => {
              const m = session.messages.find(
                (m) => m.id === editMessageData.message.id,
              );
              if (m) {
                if (editMessageData.type === "content") {
                  if (newImages.length > 0) {
                    m.content = [
                      { type: "text" as const, text: newContent },
                      ...newImages.map((url: string) => ({
                        type: "image_url" as const,
                        image_url: { url },
                      })),
                    ] as import("../client/api").MultimodalContent[];
                  } else {
                    m.content = newContent;
                  }
                }
                if (editMessageData.type === "reasoningContent") {
                  m.reasoningContent = newContent;
                }
              }
            });
            if (retryOnConfirm && editMessageData.message.role === "user") {
              onResend(editMessageData.message);
            }
          }}
          title={Locale.Chat.Actions.Edit}
          textareaRef={messageEditRef}
          message={editMessageData.message}
        />
      )}
    </>
  );
}

export function ChatPage() {
  return <Chat key={useChatStore().currentSessionIndex} />;
}
