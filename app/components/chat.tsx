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
import { updateSessionStatsBasic, updateSessionStats } from "../utils/session";
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
      chatStore.updateSession(session, updater);
    }
  };

  const handleSubmit = (text: string, images: string[]) => {
    if (text.trim() === "" && isEmpty(images)) return;

    console.log("[Chat] 🚀 开始发送消息", {
      sessionId: session.id,
      textLength: text.trim().length,
      imageCount: images.length,
      isGroupSession: !!session.groupId,
      currentMessageCount: session.messages?.length || 0,
    });

    setIsLoading(true);
    chatStore
      .onSendMessage(text, images)
      .then(async () => {
        console.log("[Chat] ✅ 消息发送完成", {
          sessionId: session.id,
          step: "handleSubmit-complete",
        });
        setIsLoading(false);
        // onSendMessage 内部已经正确处理了消息保存，无需重复保存
      })
      .catch((error) => {
        console.error("[Chat] ❌ 消息发送失败", {
          sessionId: session.id,
          error: error.message,
          step: "handleSubmit-error",
        });
        setIsLoading(false);
      });
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

    // 组内会话重试时，生成新的 batch id，避免模型回复消息和用户消息有相同的 batch id
    let newBatchId: string | undefined;
    if (session.groupId) {
      // 解析用户消息的 batch id
      const parsedId = parseGroupMessageId(userMessage.id);
      if (parsedId.isValid) {
        // 生成新的 batch id，确保模型回复消息有独立的 batch id
        newBatchId = nanoid(12);
      }
    }

    chatStore
      .onSendMessage(textContent, images, requestIndex, undefined, newBatchId)
      .then(async () => {
        setIsLoading(false);
        // onSendMessage 内部已经正确处理了消息保存，无需重复保存
      });
  };

  const deleteMessage = async (msgId?: string) => {
    updateSession((session) => {
      session.messages = session.messages.filter((m) => m.id !== msgId);
      updateSessionStatsBasic(session); // 先同步更新基础统计信息
    });

    // 获取最新的 session 对象后再保存
    const currentSession = chatStore.currentSession();
    await chatStore.saveSessionMessages(currentSession);

    // 异步更新包含系统提示词的完整统计信息
    await updateSessionStats(currentSession);

    // 根据会话类型更新状态
    if (currentSession.groupId) {
      chatStore.updateGroupSession(currentSession, (session) => {});
    } else {
      chatStore.updateSession(currentSession, (session) => {});
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
            updateSessionStatsBasic(session); // 先同步更新基础统计信息
          });

          // 获取最新的 session 对象后再保存
          const currentSession = chatStore.currentSession();
          await chatStore.saveSessionMessages(currentSession);

          // 异步更新包含系统提示词的完整统计信息
          await updateSessionStats(currentSession);

          // 根据会话类型更新状态
          if (currentSession.groupId) {
            chatStore.updateGroupSession(currentSession, (session) => {});
          } else {
            chatStore.updateSession(currentSession, (session) => {});
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
    // 只有组内会话才支持批量应用
    if (!session.groupId) {
      showToast("只有组内会话支持批量应用功能");
      return;
    }

    // 只有用户消息才支持批量应用
    if (message.role !== "user") {
      showToast("只有用户消息支持批量应用功能");
      return;
    }

    try {
      // 解析消息的 batch id
      const parsedId = parseGroupMessageId(message.id);

      if (!parsedId.isValid) {
        showToast("消息格式不支持批量应用");
        return;
      }

      const userBatchId = parsedId.batchId;
      const currentGroupId = session.groupId;

      // 获取当前组的所有会话
      const currentGroup = chatStore.groups.find(
        (g) => g.id === currentGroupId,
      );
      if (!currentGroup) {
        showToast("无法找到当前组信息");
        return;
      }

      // 首先检查当前会话是否有对应的模型回复消息
      // 找到用户消息在消息列表中的位置
      const userMessageIndex = session.messages.findIndex(
        (m) => m.id === message.id,
      );

      if (userMessageIndex === -1) {
        showToast("无法找到用户消息");
        return;
      }

      // 检查用户消息的下一个消息是否是模型回复消息
      const nextMessage = session.messages[userMessageIndex + 1];
      const hasModelReply = nextMessage && nextMessage.role === "assistant";

      if (!hasModelReply) {
        showToast("请先重试该消息，核对模型回复内容无误后，再进行批量应用");
        return;
      }

      // 获取模型回复消息的 batch id，用于在其他会话中创建相同的 batch id
      const modelMessageParsedId = parseGroupMessageId(nextMessage.id);
      const modelBatchId = modelMessageParsedId.isValid
        ? modelMessageParsedId.batchId
        : userBatchId;

      // 遍历组内所有会话
      for (const sessionId of currentGroup.sessionIds) {
        // 跳过当前会话
        if (sessionId === session.id) {
          continue;
        }

        // 先确保目标会话的消息已加载（必须等待加载完成！）
        await chatStore.loadGroupSessionMessages(sessionId);
        const targetSession = chatStore.groupSessions[sessionId]; // 重新获取，确保是最新的
        if (!targetSession || !targetSession.messages) {
          console.warn(`[BatchApply] 加载消息失败，sessionId=${sessionId}`);
          continue;
        }

        // 调试：打印当前会话所有消息
        console.log(
          `[BatchApply] 处理会话 ${sessionId}，所有消息:`,
          targetSession.messages.map((m) => ({
            id: m.id,
            role: m.role,
            batchId: parseGroupMessageId(m.id).batchId,
          })),
        );

        // 查找目标会话中是否有相同用户 batch id 的消息
        const existingUserMsgIndex = targetSession.messages.findIndex((m) => {
          const parsed = parseGroupMessageId(m.id);
          return (
            parsed.isValid &&
            parsed.batchId === userBatchId &&
            m.role === "user"
          );
        });
        // 调试：打印查找结果
        if (existingUserMsgIndex !== -1) {
          const msg = targetSession.messages[existingUserMsgIndex];
          console.log(`[BatchApply] 已存在用户消息:`, {
            index: existingUserMsgIndex,
            id: msg.id,
            role: msg.role,
            batchId: parseGroupMessageId(msg.id).batchId,
            content: msg.content,
          });
        } else {
          console.log(
            `[BatchApply] 未找到 batchId=${userBatchId} 的用户消息，将插入新消息`,
          );
        }

        if (existingUserMsgIndex !== -1) {
          // 找到相同用户 batch id 的消息，需要重新发送（类似重试）
          // 先检查该消息后面是否有模型回复消息，如果有则删除
          const nextMessageIndex = existingUserMsgIndex + 1;
          const nextMessage = targetSession.messages[nextMessageIndex];

          if (nextMessage && nextMessage.role === "assistant") {
            // 删除模型回复消息，因为要重新生成
            chatStore.updateGroupSession(targetSession, (session) => {
              session.messages.splice(nextMessageIndex, 1);
              updateSessionStatsBasic(session);
            });

            // 获取最新的会话对象后保存
            const updatedTargetSession = chatStore.groupSessions[sessionId];
            if (updatedTargetSession) {
              await chatStore.saveSessionMessages(updatedTargetSession);
            }
          }

          // 更新用户消息内容
          chatStore.updateGroupSession(targetSession, (session) => {
            session.messages[existingUserMsgIndex] = {
              ...session.messages[existingUserMsgIndex],
              content: message.content,
            };
            updateSessionStatsBasic(session);
          });

          // 获取最新的会话对象后保存
          const updatedTargetSession2 = chatStore.groupSessions[sessionId];
          if (updatedTargetSession2) {
            await chatStore.saveSessionMessages(updatedTargetSession2);
          }

          // 重新发送消息（类似重试）
          // 用户消息使用原始的用户 batch id，模型消息使用模型回复消息的 batch id
          const textContent = getMessageTextContent(message);
          const images = getMessageImages(message);

          const updatedSession = chatStore.groupSessions[sessionId];
          if (updatedSession) {
            chatStore.onSendMessage(
              textContent,
              images,
              undefined,
              sessionId,
              userBatchId, // 用户消息使用原始的用户 batch id
              modelBatchId, // 模型消息使用模型回复消息的 batch id
            );
          }
        } else {
          // 没有找到相同用户 batch id 的消息，需要创建新的用户消息
          // 用户消息使用原始的用户 batch id，模型消息使用模型回复消息的 batch id
          const textContent = getMessageTextContent(message);
          const images = getMessageImages(message);

          const updatedSession = chatStore.groupSessions[sessionId];
          if (updatedSession) {
            chatStore.onSendMessage(
              textContent,
              images,
              undefined,
              sessionId,
              userBatchId, // 用户消息使用原始的用户 batch id
              modelBatchId, // 模型消息使用模型回复消息的 batch id
            );
          }
        }

        // 调试：插入或重试后，再次打印该会话所有消息
        const afterSession = chatStore.groupSessions[sessionId];
        if (afterSession) {
          console.log(
            `[BatchApply] 应用后会话 ${sessionId}，所有消息:`,
            afterSession.messages.map((m) => ({
              id: m.id,
              role: m.role,
              batchId: parseGroupMessageId(m.id).batchId,
            })),
          );
        }
      }
      // 调试：打印本次批量应用的 batchId 和 modelBatchId
      console.log(
        `[BatchApply] 本次批量应用 batchId=${userBatchId}，modelBatchId=${modelBatchId}`,
      );

      showToast("批量应用完成");
    } catch (error) {
      console.error("[BatchApply] Failed to apply batch:", error);
      showToast("批量应用失败，请重试");
    }
  };

  const handleBatchDelete = async (message: ChatMessage) => {
    // 只有组内会话才支持批量删除
    if (!session.groupId) {
      showToast("只有组内会话支持批量删除功能");
      return;
    }

    // 只有用户消息才支持批量删除
    if (message.role !== "user") {
      showToast("只有用户消息支持批量删除功能");
      return;
    }

    try {
      // 解析消息的 batch id
      const parsedId = parseGroupMessageId(message.id);

      if (!parsedId.isValid) {
        showToast("消息格式不支持批量删除");
        return;
      }

      const batchId = parsedId.batchId;
      const currentGroupId = session.groupId;

      // 获取当前组的所有会话
      const currentGroup = chatStore.groups.find(
        (g) => g.id === currentGroupId,
      );
      if (!currentGroup) {
        showToast("无法找到当前组信息");
        return;
      }

      // 保存删除前的所有会话状态用于撤销
      const restoreStates: { [sessionId: string]: ChatMessage[] } = {};

      // 遍历组内所有会话，删除相同 batch id 的消息
      for (const sessionId of currentGroup.sessionIds) {
        const targetSession = chatStore.groupSessions[sessionId];
        if (!targetSession) {
          continue;
        }

        // 确保目标会话的消息已加载
        if (!targetSession.messages || targetSession.messages.length === 0) {
          await chatStore.loadGroupSessionMessages(sessionId);
        }

        // 保存删除前的消息状态
        restoreStates[sessionId] = [...targetSession.messages];

        // 查找并删除相同 batch id 的消息
        const messagesToDelete = targetSession.messages.filter((m) => {
          const parsed = parseGroupMessageId(m.id);
          return parsed.isValid && parsed.batchId === batchId;
        });

        if (messagesToDelete.length > 0) {
          // 删除相同 batch id 的消息
          chatStore.updateGroupSession(targetSession, (session) => {
            session.messages = session.messages.filter((m) => {
              const parsed = parseGroupMessageId(m.id);
              return !parsed.isValid || parsed.batchId !== batchId;
            });
            updateSessionStatsBasic(session);
          });

          // 获取最新的会话对象后保存
          const updatedTargetSession = chatStore.groupSessions[sessionId];
          if (updatedTargetSession) {
            await chatStore.saveSessionMessages(updatedTargetSession);
          }

          // 异步更新包含系统提示词的完整统计信息
          const updatedSession = chatStore.groupSessions[sessionId];
          if (updatedSession) {
            await updateSessionStats(updatedSession);
            chatStore.updateGroupSession(updatedSession, (session) => {});
          }
        }
      }

      showToast(
        Locale.Chat.BatchDeleteToast,
        {
          text: Locale.Chat.Revert,
          async onClick() {
            // 撤销删除操作
            for (const sessionId of Object.keys(restoreStates)) {
              const targetSession = chatStore.groupSessions[sessionId];
              if (targetSession) {
                chatStore.updateGroupSession(targetSession, (session) => {
                  session.messages = restoreStates[sessionId];
                  updateSessionStatsBasic(session);
                });

                // 获取最新的会话对象后保存
                const updatedTargetSession = chatStore.groupSessions[sessionId];
                if (updatedTargetSession) {
                  await chatStore.saveSessionMessages(updatedTargetSession);
                }

                // 异步更新包含系统提示词的完整统计信息
                const updatedSession = chatStore.groupSessions[sessionId];
                if (updatedSession) {
                  await updateSessionStats(updatedSession);
                  chatStore.updateGroupSession(updatedSession, (session) => {});
                }
              }
            }
          },
        },
        5000,
      );
    } catch (error) {
      console.error("[BatchDelete] Failed to delete batch:", error);
      showToast(Locale.Chat.Actions.BatchDeleteFailed);
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
    await updateSessionStats(currentSession);

    // 根据会话类型更新状态
    if (currentSession.groupId) {
      chatStore.updateGroupSession(currentSession, (session) => {});
    } else {
      chatStore.updateSession(currentSession, (session) => {});
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
              onBatchDelete={handleBatchDelete}
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
