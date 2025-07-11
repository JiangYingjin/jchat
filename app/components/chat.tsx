import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

import { useSubmitHandler, useTripleClick } from "../utils/hooks";
import {
  ChatMessage,
  useChatStore,
  SystemMessageData,
  saveSystemMessageContentToStorage,
  loadSystemMessageContentFromStorage,
} from "../store";

import { updateSessionStats } from "../utils/session";

import {
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
} from "../utils";

import { determineModelForSystemPrompt } from "../utils/model";

import { ChatControllerPool } from "../client/controller";

import Locale from "../locales";

import styles from "./chat.module.scss";
import { showToast } from "./ui-lib";
import { useNavigate, useSearchParams } from "react-router-dom";
import { REQUEST_TIMEOUT_MS } from "../constant";
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
import { findMessagePairForResend } from "../../utils/message";

function Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const allModels = chatStore.models;

  const [showExport, setShowExport] = useState(false);

  const messageEditRef = useRef<HTMLTextAreaElement>(null);
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

  // 处理消息提交
  const handleSubmit = (text: string, images: string[]) => {
    if (text.trim() === "" && isEmpty(images)) return;

    setIsLoading(true);
    chatStore.onSendMessage(text, images).then(() => setIsLoading(false));

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
    const { userMessage, botMessage, requestIndex } = findMessagePairForResend(
      session.messages,
      message.id,
    );

    if (!userMessage) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore
      .onSendMessage(textContent, images, requestIndex)
      .then(() => setIsLoading(false));
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

      // 使用集中管理的模型切换策略
      const newModel = determineModelForSystemPrompt(
        content.trim(),
        session.model,
        allModels,
        session.isModelManuallySelected ?? false,
      );
      if (newModel) {
        session.model = newModel;
        session.isModelManuallySelected = true;
        console.log(
          `[AutoSwitch] 系统提示词内容触发自动切换到 ${newModel} 模型`,
        );
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
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
              setHitBottom={setHitBottom}
            />
            <ChatInputPanel
              onSubmit={handleSubmit}
              sessionId={session.id}
              autoFocus={autoFocus}
              longInputMode={session.longInputMode}
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
