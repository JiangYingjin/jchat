"use client";

import React, { useState, useEffect, useCallback } from "react";
import styles from "../styles/file-drop-zone.module.scss";
import {
  validateDropEvent,
  extractFilesFromDrop,
  extractFileInfo,
  filterSupportedFiles,
  sortFilesByName,
  logFileInfo,
  formatFileSize,
  formatLastModified,
  getFileIcon,
  type DroppedFileInfo,
} from "../utils/file-drop";
import { useChatStore, type ChatSession } from "../store";
import { systemMessageStorage } from "../store/system";
import { uploadImage } from "../utils/chat";
import { showToast } from "./ui-lib";

interface FileDropZoneProps {
  children: React.ReactNode;
}

export function FileDropZone({ children }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [droppedFiles, setDroppedFiles] = useState<DroppedFileInfo[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [rawFiles, setRawFiles] = useState<File[]>([]);

  const chatStore = useChatStore();

  // 检查是否处于组内会话模式
  const isInGroupSessionsView = () => {
    const state = useChatStore.getState();
    const { chatListView, chatListGroupView, groups, currentGroupIndex } =
      state;
    return (
      chatListView === "groups" &&
      chatListGroupView === "group-sessions" &&
      groups.length > 0
    );
  };

  // 检查是否处于组列表模式
  const isInGroupsView = () => {
    const state = useChatStore.getState();
    const { chatListView, chatListGroupView, groups, currentGroupIndex } =
      state;
    return (
      chatListView === "groups" &&
      chatListGroupView === "groups" &&
      groups.length > 0
    );
  };

  // 获取当前组的会话信息
  const getCurrentGroupSessions = () => {
    const state = useChatStore.getState();
    const { groups, currentGroupIndex, groupSessions } = state;
    const currentGroup = groups[currentGroupIndex];
    if (!currentGroup) return [];

    return currentGroup.sessionIds
      .map((sessionId: string) => groupSessions[sessionId])
      .filter(Boolean) as ChatSession[];
  };

  // 附加文件到会话的系统提示词 - 独立函数
  const appendFileToSession = async (file: File, session: ChatSession) => {
    try {
      // 获取当前系统提示词
      const currentSystemData = await systemMessageStorage.get(session.id);

      let newText = currentSystemData.text || "";
      let newImages = [...(currentSystemData.images || [])];

      const ext = file.name.split(".").pop()?.toLowerCase();

      if (["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
        // 图片文件：上传图片并添加到系统提示词
        const imageUrl = await uploadImage(file);
        newImages.push(imageUrl);
      } else if (["md", "txt"].includes(ext || "")) {
        // 文本文件：读取内容作为系统提示词
        const text = await file.text();

        // 如果已有文本，添加分隔符
        if (newText.trim()) {
          newText += "\n\n---\n\n";
        }
        newText += text;
      }

      // 保存更新后的系统提示词
      await systemMessageStorage.save(session.id, {
        text: newText,
        images: newImages,
        scrollTop: currentSystemData.scrollTop || 0,
        selection: currentSystemData.selection || { start: 0, end: 0 },
        updateAt: Date.now(),
      });

      // 更新会话统计信息
      const { updateSessionStatsAsync } = await import("../utils/session");
      await updateSessionStatsAsync(session);

      if (session.groupId) {
        chatStore.updateGroupSession(session, () => {});
      } else {
        chatStore.updateSession(session, () => {});
      }
    } catch (error) {
      console.error(`处理文件 ${file.name} 失败:`, error);
      throw error;
    }
  };

  // 为未匹配的文件创建新会话 - 独立函数
  const createNewSessionsForFiles = async (files: File[]) => {
    const state = useChatStore.getState();
    const { groups, currentGroupIndex } = state;
    const currentGroup = groups[currentGroupIndex];

    if (!currentGroup) return;

    for (const file of files) {
      // 创建新的组内会话
      await chatStore.newGroupSession();

      // 等待状态完全同步
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 获取新创建的会话
      const updatedState = useChatStore.getState();
      const updatedGroup = updatedState.groups[currentGroupIndex];
      const newSessionId =
        updatedGroup.sessionIds[updatedGroup.sessionIds.length - 1];
      const newSessionData = updatedState.groupSessions[newSessionId];

      if (newSessionData) {
        // 使用 updateGroupSession 方法正确更新会话的 sourceName
        chatStore.updateGroupSession(newSessionData, (session) => {
          session.sourceName = file.name;
        });
        // 等待状态更新完成
        await new Promise((resolve) => setTimeout(resolve, 10));
        // 处理文件内容并设置为系统提示词
        await appendFileToSession(file, newSessionData);
      } else {
        console.error(
          `[创建新会话] 创建会话后无法找到会话数据: ${newSessionId}`,
        );
      }
    }
  };

  // 按 sourceName 升序重新排序组内会话 - 独立函数
  const reorderGroupSessionsBySourceName = async () => {
    const state = useChatStore.getState();
    const { groups, currentGroupIndex, groupSessions } = state;
    const currentGroup = groups[currentGroupIndex];

    if (!currentGroup) return;

    // 获取所有会话并按 sourceName 排序
    const sortedSessions = currentGroup.sessionIds
      .map((sessionId: string) => groupSessions[sessionId])
      .filter(Boolean)
      .sort((a: ChatSession, b: ChatSession) => {
        const sourceNameA = a.sourceName || "";
        const sourceNameB = b.sourceName || "";
        return sourceNameA.localeCompare(sourceNameB);
      });

    // 更新组的会话ID顺序
    const newSessionIds = sortedSessions.map((session) => session.id);

    useChatStore.setState((state) => {
      const newGroups = [...state.groups];
      newGroups[currentGroupIndex] = {
        ...currentGroup,
        sessionIds: newSessionIds,
      };
      return { groups: newGroups };
    });
  };

  // 按文件名附加逻辑 - 独立函数
  const appendByFileName = async (files: File[]) => {
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));

    // 按文件名匹配会话
    const matchedSessions: { file: File; session: ChatSession }[] = [];
    const unmatchedFiles: File[] = [];

    // 获取最新的会话状态
    const groupSessions = getCurrentGroupSessions();

    for (const file of sortedFiles) {
      const matchingSession = groupSessions.find(
        (session) => session.sourceName === file.name,
      );
      if (matchingSession) {
        matchedSessions.push({ file, session: matchingSession });
      } else {
        unmatchedFiles.push(file);
      }
    }

    // 处理匹配的会话
    for (const { file, session } of matchedSessions) {
      // 确保会话的 sourceName 被正确设置
      if (session.sourceName !== file.name) {
        chatStore.updateGroupSession(session, (s) => {
          s.sourceName = file.name;
        });
        // 等待状态更新完成
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // 附加文件内容到系统提示词
      await appendFileToSession(file, session);
    }

    // 为未匹配的文件创建新会话
    if (unmatchedFiles.length > 0) {
      await createNewSessionsForFiles(unmatchedFiles);
    }

    // 按 sourceName 升序重新排序组内会话
    await reorderGroupSessionsBySourceName();
  };

  // 升序附加逻辑 - 独立函数
  const appendInOrder = async (files: File[]) => {
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));

    // 获取最新的会话状态
    const groupSessions = getCurrentGroupSessions();

    // 如果文件数量与会话数量相同，按顺序附加
    if (sortedFiles.length === groupSessions.length) {
      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        const session = groupSessions[i];
        // 确保会话的 sourceName 被正确设置
        if (session.sourceName !== file.name) {
          chatStore.updateGroupSession(session, (s) => {
            s.sourceName = file.name;
          });
          // 等待状态更新完成
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await appendFileToSession(file, session);
      }
    } else {
      // 如果数量不同，先按文件名匹配，然后为剩余文件创建新会话
      await appendByFileName(files);
    }
  };

  // 处理拖拽进入
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (validateDropEvent(e)) {
      setDragCounter((prev) => prev + 1);
      setIsDragOver(true);
    }
  }, []);

  // 处理拖拽离开
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setDragCounter((prev) => {
      const newCounter = prev - 1;
      if (newCounter <= 0) {
        setIsDragOver(false);
        return 0;
      }
      return newCounter;
    });
  }, []);

  // 处理拖拽悬停
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  // 处理文件拖放
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragOver(false);
    setDragCounter(0);

    if (!validateDropEvent(e)) {
      return;
    }

    const files = extractFilesFromDrop(e);
    if (files.length > 0) {
      const fileInfos = files.map(extractFileInfo);

      // 过滤：只保留支持的文件类型
      const filteredFiles = filterSupportedFiles(fileInfos);

      // 如果过滤后没有有效文件，则直接返回
      if (filteredFiles.length === 0) {
        console.log("❌ 没有找到支持的文件类型");
        return;
      }

      // 排序：按文件名升序排列
      const sortedFiles = sortFilesByName(filteredFiles);

      setDroppedFiles(sortedFiles);
      setRawFiles(files); // 保存原始文件对象
      setShowFiles(true);

      // 记录文件信息到控制台
      logFileInfo(sortedFiles);

      // 显示成功提示
      console.log(`✅ 成功接收 ${sortedFiles.length} 个有效文件`);
    }
  }, []);

  // 关闭文件列表
  const handleCloseFiles = useCallback(() => {
    setShowFiles(false);
    setDroppedFiles([]);
    setRawFiles([]);
  }, []);

  // 处理 ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && showFiles) {
        handleCloseFiles();
      }
    },
    [showFiles, handleCloseFiles],
  );

  // 创建会话组
  const handleCreateGroup = useCallback(async () => {
    if (rawFiles.length === 0) return;

    setIsCreatingGroup(true);
    try {
      const group = await chatStore.createGroupFromFiles(rawFiles);
      if (group) {
        // 创建成功后关闭文件列表
        handleCloseFiles();
      }
    } catch (error) {
      console.error("创建会话组失败:", error);
    } finally {
      setIsCreatingGroup(false);
    }
  }, [rawFiles, chatStore, handleCloseFiles]);

  // 按相同文件名附加至提示词
  const handleAppendByFileName = useCallback(async () => {
    if (rawFiles.length === 0) return;

    setIsProcessingFiles(true);
    try {
      await appendByFileName(rawFiles);
      showToast(`成功处理 ${rawFiles.length} 个文件`);
      handleCloseFiles();
    } catch (error) {
      console.error("按文件名附加失败:", error);
      showToast("处理文件失败，请重试");
    } finally {
      setIsProcessingFiles(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFiles, handleCloseFiles]);

  // 升序附加至提示词
  const handleAppendInOrder = useCallback(async () => {
    if (rawFiles.length === 0) return;

    setIsProcessingFiles(true);
    try {
      await appendInOrder(rawFiles);
      showToast(`成功按顺序附加 ${rawFiles.length} 个文件`);
      handleCloseFiles();
    } catch (error) {
      console.error("升序附加失败:", error);
      showToast("处理文件失败，请重试");
    } finally {
      setIsProcessingFiles(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFiles, handleCloseFiles]);

  // 添加全局事件监听器
  useEffect(() => {
    const dragEnter = (e: DragEvent) => handleDragEnter(e);
    const dragLeave = (e: DragEvent) => handleDragLeave(e);
    const dragOver = (e: DragEvent) => handleDragOver(e);
    const drop = (e: DragEvent) => handleDrop(e);
    const keyDown = (e: KeyboardEvent) => handleKeyDown(e);

    document.addEventListener("dragenter", dragEnter);
    document.addEventListener("dragleave", dragLeave);
    document.addEventListener("dragover", dragOver);
    document.addEventListener("drop", drop);
    document.addEventListener("keydown", keyDown);

    return () => {
      document.removeEventListener("dragenter", dragEnter);
      document.removeEventListener("dragleave", dragLeave);
      document.removeEventListener("dragover", dragOver);
      document.removeEventListener("drop", drop);
      document.removeEventListener("keydown", keyDown);
    };
  }, [
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleKeyDown,
  ]);

  // 检查当前模式
  const inGroupSessionsView = isInGroupSessionsView();
  const inGroupsView = isInGroupsView();
  const currentGroupSessions = getCurrentGroupSessions();
  const fileCount = rawFiles.length;
  const sessionCount = currentGroupSessions.length;

  // 判断是否应该显示附加按钮
  const shouldShowAppendButtons = inGroupSessionsView || inGroupsView;

  return (
    <div className={styles.container}>
      {children}

      {/* 拖拽覆盖层 */}
      {isDragOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragContent}>
            <div className={styles.dragIcon}>📁</div>
            <div className={styles.dragTitle}>
              {shouldShowAppendButtons
                ? "释放文件以附加到组内会话"
                : "释放文件以创建会话组"}
            </div>
            <div className={styles.dragSubtitle}>
              支持 JPG、JPEG、PNG、WebP、MD、TXT 文件
            </div>
          </div>
        </div>
      )}

      {/* 文件列表模态框 */}
      {showFiles && droppedFiles.length > 0 && (
        <div className={styles.fileModal}>
          <div className={styles.fileModalContent}>
            <div className={styles.fileModalHeader}>
              <h3 className={styles.fileModalTitle}>
                <span>📁</span>
                <span>拖放文件 ({droppedFiles.length})</span>
              </h3>
              <button
                className={styles.closeButton}
                onClick={handleCloseFiles}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className={styles.fileList}>
              {droppedFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className={styles.fileItem}>
                  <div className={styles.fileIcon}>{getFileIcon(file)}</div>
                  <div className={styles.fileInfo}>
                    <div className={styles.fileName} title={file.name}>
                      {file.name}
                    </div>
                    <div className={styles.fileDetails}>
                      <span className={styles.fileSize}>
                        {formatFileSize(file.size)}
                      </span>
                      {file.type && (
                        <span className={styles.fileType}>{file.type}</span>
                      )}
                      <span className={styles.fileDate}>
                        {formatLastModified(file.lastModified)}
                      </span>
                    </div>
                    {file.webkitRelativePath && (
                      <div className={styles.filePath}>
                        <span>📂</span>
                        <span>{file.webkitRelativePath}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.fileModalFooter}>
              <div className={styles.fileModalActions}>
                {/* 新建组会话按钮 - 始终显示 */}
                <button
                  className={styles.createGroupButton}
                  onClick={handleCreateGroup}
                  disabled={isCreatingGroup}
                >
                  {isCreatingGroup ? "创建中..." : `新建组会话`}
                </button>

                {/* 组模式下的额外按钮 */}
                {shouldShowAppendButtons && (
                  <>
                    {/* 如果文件数量和会话数量不同，显示按文件名附加按钮 */}
                    {fileCount !== sessionCount && (
                      <button
                        className={styles.appendButton}
                        onClick={handleAppendByFileName}
                        disabled={isProcessingFiles}
                      >
                        {isProcessingFiles ? "处理中..." : `按文件名附加`}
                      </button>
                    )}

                    {/* 如果文件数量和会话数量相同，显示升序附加按钮和按文件名附加按钮 */}
                    {fileCount === sessionCount && (
                      <>
                        <button
                          className={styles.appendButton}
                          onClick={handleAppendInOrder}
                          disabled={isProcessingFiles}
                        >
                          {isProcessingFiles ? "处理中..." : `升序附加`}
                        </button>
                        <button
                          className={styles.appendButton}
                          onClick={handleAppendByFileName}
                          disabled={isProcessingFiles}
                        >
                          {isProcessingFiles ? "处理中..." : `按文件名附加`}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className={styles.fileStats}>
                {shouldShowAppendButtons
                  ? "文件内容将附加到现有会话的系统提示词中"
                  : "每个文件将创建一个独立的会话，文件内容将作为系统提示词"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
