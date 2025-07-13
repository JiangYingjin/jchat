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
import { useChatStore } from "../store";

interface FileDropZoneProps {
  children: React.ReactNode;
}

export function FileDropZone({ children }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [droppedFiles, setDroppedFiles] = useState<DroppedFileInfo[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [rawFiles, setRawFiles] = useState<File[]>([]);

  const chatStore = useChatStore();

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

  // 添加全局事件监听器
  useEffect(() => {
    const dragEnter = (e: DragEvent) => handleDragEnter(e);
    const dragLeave = (e: DragEvent) => handleDragLeave(e);
    const dragOver = (e: DragEvent) => handleDragOver(e);
    const drop = (e: DragEvent) => handleDrop(e);

    document.addEventListener("dragenter", dragEnter);
    document.addEventListener("dragleave", dragLeave);
    document.addEventListener("dragover", dragOver);
    document.addEventListener("drop", drop);

    return () => {
      document.removeEventListener("dragenter", dragEnter);
      document.removeEventListener("dragleave", dragLeave);
      document.removeEventListener("dragover", dragOver);
      document.removeEventListener("drop", drop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <div className={styles.container}>
      {children}

      {/* 拖拽覆盖层 */}
      {isDragOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragContent}>
            <div className={styles.dragIcon}>📁</div>
            <div className={styles.dragTitle}>释放文件以创建会话组</div>
            <div className={styles.dragSubtitle}>
              支持 jpg, jpeg, png, webp, md, txt 文件，将按文件名排序创建会话组
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
                📁 拖放的文件 ({droppedFiles.length})
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
                        📂 {file.webkitRelativePath}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.fileModalFooter}>
              <div className={styles.fileModalActions}>
                <button
                  className={styles.createGroupButton}
                  onClick={handleCreateGroup}
                  disabled={isCreatingGroup}
                >
                  {isCreatingGroup
                    ? "创建中..."
                    : `创建会话组 (${droppedFiles.length} 个文件)`}
                </button>
              </div>
              <div className={styles.fileStats}>
                每个文件将创建一个独立的会话，文件内容将作为系统提示词
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
