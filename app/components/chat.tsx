import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isEmpty } from "lodash-es";
import { nanoid } from "nanoid";

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
import { parseGroupMessageId } from "../utils/group";

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

  const handleBatchApply = async (message: ChatMessage) => {
    console.log("[BatchApply] 开始批量应用，消息ID:", message.id);
    console.log("[BatchApply] 消息内容:", getMessageTextContent(message));

    // 只有组内会话才支持批量应用
    if (!session.groupId) {
      console.log("[BatchApply] 不是组内会话，退出");
      showToast("只有组内会话支持批量应用功能");
      return;
    }

    // 只有用户消息才支持批量应用
    if (message.role !== "user") {
      console.log("[BatchApply] 不是用户消息，退出");
      showToast("只有用户消息支持批量应用功能");
      return;
    }

    try {
      // 解析消息的 batch id
      const parsedId = parseGroupMessageId(message.id);
      console.log("[BatchApply] 解析的batchId:", parsedId);

      if (!parsedId.isValid) {
        console.log("[BatchApply] 消息格式不支持批量应用");
        showToast("消息格式不支持批量应用");
        return;
      }

      const batchId = parsedId.batchId;
      const currentGroupId = session.groupId;
      console.log(
        "[BatchApply] 当前组ID:",
        currentGroupId,
        "batchId:",
        batchId,
      );

      // 获取当前组的所有会话
      const currentGroup = chatStore.groups.find(
        (g) => g.id === currentGroupId,
      );
      if (!currentGroup) {
        console.log("[BatchApply] 无法找到当前组信息");
        showToast("无法找到当前组信息");
        return;
      }

      console.log("[BatchApply] 组内会话数量:", currentGroup.sessionIds.length);
      console.log("[BatchApply] 组内会话IDs:", currentGroup.sessionIds);

      // 遍历组内所有会话
      for (const sessionId of currentGroup.sessionIds) {
        console.log("[BatchApply] 处理会话:", sessionId);

        // 跳过当前会话
        if (sessionId === session.id) {
          console.log("[BatchApply] 跳过当前会话:", sessionId);
          continue;
        }

        const targetSession = chatStore.groupSessions[sessionId];
        if (!targetSession) {
          console.warn(`[BatchApply] Session ${sessionId} not found`);
          continue;
        }

        console.log(
          "[BatchApply] 目标会话消息数量:",
          targetSession.messages.length,
        );

        // 确保目标会话的消息已加载
        if (!targetSession.messages || targetSession.messages.length === 0) {
          console.log("[BatchApply] 加载目标会话消息:", sessionId);
          await chatStore.loadGroupSessionMessages(sessionId);
        }

        // 查找目标会话中是否有相同 batch id 的消息
        const existingMessageIndex = targetSession.messages.findIndex((m) => {
          const parsed = parseGroupMessageId(m.id);
          return parsed.isValid && parsed.batchId === batchId;
        });

        console.log(
          "[BatchApply] 查找结果 - existingMessageIndex:",
          existingMessageIndex,
        );

        if (existingMessageIndex !== -1) {
          console.log("[BatchApply] 找到相同batchId的消息，开始同步内容");

          // 找到相同 batch id 的消息，只更新内容，不重复发送
          const existingMessage = targetSession.messages[existingMessageIndex];
          console.log("[BatchApply] 现有消息ID:", existingMessage.id);
          console.log(
            "[BatchApply] 现有消息内容:",
            getMessageTextContent(existingMessage),
          );

          // 同步消息内容
          chatStore.updateGroupSession(targetSession, (session) => {
            console.log(
              "[BatchApply] 更新消息内容，索引:",
              existingMessageIndex,
            );
            session.messages[existingMessageIndex] = {
              ...existingMessage,
              content: message.content,
            };
            updateSessionStats(session);
          });

          // 保存更新后的消息
          await chatStore.saveSessionMessages(targetSession);
          console.log("[BatchApply] 消息内容同步完成，不发送新请求");

          // 注意：这里不调用 onSendMessage，因为消息已经存在，只需要同步内容
          // 如果需要重新生成回复，用户可以在目标会话中手动重试
        } else {
          console.log("[BatchApply] 没有找到相同batchId的消息，添加新消息");

          // 没有找到相同 batch id 的消息，直接调用 onSendMessage 添加新消息
          // 注意：不要手动添加消息，让 onSendMessage 来处理
          const textContent = getMessageTextContent(message);
          const images = getMessageImages(message);
          console.log("[BatchApply] 准备发送的内容:", textContent);
          console.log("[BatchApply] 准备发送的图片数量:", images.length);

          // 直接调用 onSendMessage，让它处理消息的添加和发送
          const updatedSession = chatStore.groupSessions[sessionId];
          if (updatedSession) {
            console.log(
              "[BatchApply] 准备调用onSendMessage，目标会话ID:",
              sessionId,
            );
            console.log(
              "[BatchApply] 调用前目标会话消息数量:",
              updatedSession.messages.length,
            );
            chatStore.onSendMessage(
              textContent,
              images,
              undefined,
              sessionId,
              batchId,
            );
            console.log("[BatchApply] onSendMessage调用完成");
          }
        }
      }

      console.log("[BatchApply] 批量应用完成");
      showToast("批量应用完成");
    } catch (error) {
      console.error("[BatchApply] Failed to apply batch:", error);
      showToast("批量应用失败，请重试");
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
              onBatchApply={handleBatchApply}
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
