import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isEmpty } from "lodash-es";

// --- Local Imports ---
import {
  ChatMessage,
  useChatStore,
  SystemMessageData,
  systemMessageStorage,
  ChatSession,
} from "../store";
import { useSubmitHandler, useTripleClick } from "../utils/hooks";
import { updateSessionStats, updateSessionStatsAsync } from "../utils/session";
import {
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
} from "../utils";
import { determineModelForSystemPrompt } from "../utils/model";
import { prettyObject } from "../utils/format";
import { handleUnauthorizedResponse, handleUrlAuthCode } from "../utils/auth";
import { findMessagePairForResend } from "../../utils/message";

// --- Client & Constants ---
import { ChatControllerPool } from "../client/controller";
import { REQUEST_TIMEOUT_MS } from "../constant";
import Locale from "../locales";

// --- Components ---
import { showToast } from "./ui-lib";
import { ChatInputPanel } from "./chat-input-panel";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import {
  SystemPromptEditModal,
  EditMessageWithImageModal,
} from "./message-edit-modals";
import { SessionEditorModal } from "./session-editor-modal";
import { ExportMessageModal } from "./exporter";

// --- Styles ---
import styles from "../styles/chat.module.scss";

function Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  // --- State, Refs, and Hooks ---
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const allModels = chatStore.models;

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobileScreen = useMobileScreen();

  const messageEditRef = useRef<HTMLTextAreaElement>(null);

  // Component State
  const [isLoading, setIsLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hitBottom, setHitBottom] = useState(true); // Managed by MessageList, passed down

  // Modal Visibility State
  const [showExport, setShowExport] = useState(false);
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [showSystemPromptEdit, setShowSystemPromptEdit] = useState(false);
  const [showEditMessageModal, setShowEditMessageModal] = useState(false);

  // Data for Modals
  const [systemPromptData, setSystemPromptData] = useState<SystemMessageData>({
    text: "",
    images: [],
    scrollTop: 0,
    selection: { start: 0, end: 0 },
    updateAt: Date.now(),
  });
  const [editMessageData, setEditMessageData] = useState<{
    message: ChatMessage;
    type: "content" | "reasoningContent";
    select: { anchorText: string; extendText: string };
  } | null>(null);

  // Custom Hooks
  useSubmitHandler();
  const handleTripleClick = useTripleClick(messageEditRef);

  // --- Memoized and Derived Values ---
  const messages = useMemo(() => {
    // Filter out system messages for rendering
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  const autoFocus = !isMobileScreen; // Wont auto focus on mobile screens

  // --- Core Logic Handlers ---

  // 根据会话类型选择正确的更新方法
  const updateSession = (updater: (session: ChatSession) => void) => {
    if (session.groupId) {
      chatStore.updateGroupSession(session, updater);
    } else {
      chatStore.updateTargetSession(session, updater);
    }
  };

  const handleSubmit = (text: string, images: string[]) => {
    if (text.trim() === "" && isEmpty(images)) return;
    setIsLoading(true);
    chatStore.onSendMessage(text, images).then(() => setIsLoading(false));
    setAutoScroll(true);
  };

  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
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

  const deleteMessage = async (msgId?: string) => {
    updateSession((session) => {
      session.messages = session.messages.filter((m) => m.id !== msgId);
      updateSessionStats(session); // 先同步更新基础统计信息
    });
    await chatStore.saveSessionMessages(session);

    // 异步更新包含系统提示词的完整统计信息
    const currentSession = chatStore.currentSession();
    await updateSessionStatsAsync(currentSession);

    // 根据会话类型更新状态
    if (currentSession.groupId) {
      chatStore.updateGroupSession(currentSession, () => {});
    } else {
      chatStore.updateTargetSession(currentSession, () => {});
    }
  };

  const onDelete = (msgId: string) => {
    const prevMessages = session.messages.slice();
    deleteMessage(msgId);
    showToast(
      Locale.Chat.DeleteMessageToast,
      {
        text: Locale.Chat.Revert,
        async onClick() {
          updateSession((session) => {
            session.messages = prevMessages;
            updateSessionStats(session); // 先同步更新基础统计信息
          });
          await chatStore.saveSessionMessages(session);

          // 异步更新包含系统提示词的完整统计信息
          const currentSession = chatStore.currentSession();
          await updateSessionStatsAsync(currentSession);

          // 根据会话类型更新状态
          if (currentSession.groupId) {
            chatStore.updateGroupSession(currentSession, () => {});
          } else {
            chatStore.updateTargetSession(currentSession, () => {});
          }
        },
      },
      5000,
    );
  };

  const handleBranch = async (message: ChatMessage, messageIndex: number) => {
    try {
      await chatStore.branchSessionFrom(message, messageIndex);
    } catch (error) {
      console.error("Failed to branch session:", error);
      showToast(Locale.Chat.Actions.BranchFailed);
    }
  };

  const handleSystemPromptSave = async (
    content: string,
    images: string[],
    scrollTop?: number,
    selection?: { start: number; end: number }, // 修改这里 end: 0 => end: number
  ) => {
    // 先保存系统提示词到存储
    if (content.trim() || images.length > 0) {
      await systemMessageStorage.save(session.id, {
        text: content.trim(),
        images,
        scrollTop: scrollTop || 0,
        selection: selection || { start: 0, end: 0 },
        updateAt: Date.now(),
      });
    } else {
      // 如果系统提示词被清空，删除存储的系统提示词
      await systemMessageStorage.delete(session.id);
    }

    updateSession((session) => {
      session.messages = session.messages.filter((m) => m.role !== "system");

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
          `[AutoSwitch] Switched to ${newModel} due to system prompt.`,
        );
      }
    });

    // 等待系统提示词保存完成后再更新会话统计信息
    const currentSession = chatStore.currentSession();
    await updateSessionStatsAsync(currentSession);

    // 根据会话类型更新状态
    if (currentSession.groupId) {
      chatStore.updateGroupSession(currentSession, () => {});
    } else {
      chatStore.updateTargetSession(currentSession, () => {});
    }
  };

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

    setTimeout(() => {
      const textarea = messageEditRef.current;
      if (!textarea) return;

      if (message.role === "user" || message.role === "system") {
        textarea.selectionStart = textarea.value.length;
        textarea.selectionEnd = textarea.value.length;
        textarea.focus();
        return;
      }

      if (select.anchorText || select.extendText) {
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
        const lineHeight = parseInt(style.lineHeight, 10) || 21;
        const position = (lineNumber - 1) * lineHeight;
        textarea.scrollTo({ top: Math.max(0, position), behavior: "smooth" });
      }
    }, 100);
  };

  // --- Side Effects ---

  // Handle URL authentication code on initial load
  useEffect(() => {
    handleUrlAuthCode(searchParams, setSearchParams, navigate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up global handler for unauthorized API responses
  useEffect(() => {
    (window as any).__handleUnauthorized = () =>
      handleUnauthorizedResponse(navigate);
    return () => {
      delete (window as any).__handleUnauthorized;
    };
  }, [navigate]);

  // Default to long input mode on mobile devices
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      updateSession((session) => {
        session.longInputMode = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen, session.id]);

  // Clean up stale messages and update model if necessary
  useEffect(() => {
    updateSession((session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) m.streaming = false;
          if (m.content.length === 0 && m.role !== "system") {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      const currentModel = session.model;
      const isCurrentModelValid = allModels.includes(currentModel);
      if (
        !isCurrentModelValid &&
        !session.isModelManuallySelected &&
        allModels.length > 0
      ) {
        session.model = allModels[0];
        console.log(
          `[ModelUpdate] Auto-updated invalid model ${currentModel} to ${allModels[0]}`,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // 确保会话切换时自动加载消息
  useEffect(() => {
    if (session && (!session.messages || session.messages.length === 0)) {
      if (session.groupId) {
        // 组内会话：加载组内会话消息
        chatStore.loadGroupSessionMessages(session.id);
      } else {
        // 普通会话：加载普通会话消息
        chatStore.loadSessionMessages(chatStore.currentSessionIndex);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // --- Render Logic ---
  return (
    <>
      <div className={styles.chat} key={session.id}>
        <ChatHeader
          sessionTitle={session.title}
          messageCount={session.messageCount}
          onEditSystemMessageClick={async () => {
            let systemData = await systemMessageStorage.get(session.id);
            setSystemPromptData(systemData);
            setShowSystemPromptEdit(true);
          }}
          onEditSessionClick={() => setIsEditingSession(true)}
          onExportClick={() => setShowExport(true)}
          onDeleteSessionClick={async () => {
            // 对于组内会话，需要特殊处理删除逻辑
            if (session.groupId) {
              await chatStore.deleteGroupSession(session.id);
            } else {
              chatStore.deleteSession(chatStore.currentSessionIndex);
            }
          }}
          onDeleteGroupClick={async () => {
            // 删除整个组
            if (session.groupId) {
              await chatStore.deleteGroup(session.groupId);
            }
          }}
          hasGroupId={!!session.groupId}
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

      {/* --- Modals --- */}
      {isEditingSession && (
        <SessionEditorModal onClose={() => setIsEditingSession(false)} />
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
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
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
          onSave={(newContent, newImages, retryOnConfirm) => {
            updateSession((session) => {
              const m = session.messages.find(
                (m) => m.id === editMessageData.message.id,
              );
              if (m) {
                if (editMessageData.type === "content") {
                  if (newImages.length > 0) {
                    m.content = [
                      { type: "text", text: newContent },
                      ...newImages.map((url) => ({
                        type: "image_url" as const,
                        image_url: { url },
                      })),
                    ] as any; // Type assertion to match MultimodalContent
                  } else {
                    m.content = newContent;
                  }
                } else if (editMessageData.type === "reasoningContent") {
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

/**
 * A wrapper component that forces the Chat component to re-mount when the session changes.
 * This is a clean way to reset all component state when switching conversations.
 */
export function ChatPage() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  // 统一使用会话ID作为key，确保会话切换的可靠性
  return <Chat key={session.id} />;
}
