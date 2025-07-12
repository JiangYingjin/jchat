"use client";

import React, { useState, useEffect, useCallback } from "react";
import styles from "../styles/file-drop-zone.module.scss";
import {
  validateDropEvent,
  extractFilesFromDrop,
  extractFileInfo,
  sortFilesByName,
  logFileInfo,
  formatFileSize,
  formatLastModified,
  getFileIcon,
  type DroppedFileInfo,
} from "../utils/file-drop";

interface FileDropZoneProps {
  children: React.ReactNode;
}

export function FileDropZone({ children }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [droppedFiles, setDroppedFiles] = useState<DroppedFileInfo[]>([]);
  const [showFiles, setShowFiles] = useState(false);

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
      const sortedFiles = sortFilesByName(fileInfos);

      setDroppedFiles(sortedFiles);
      setShowFiles(true);

      // 记录文件信息到控制台
      logFileInfo(sortedFiles);

      // 显示成功提示
      console.log(`✅ 成功接收 ${sortedFiles.length} 个文件`);
    }
  }, []);

  // 关闭文件列表
  const handleCloseFiles = useCallback(() => {
    setShowFiles(false);
    setDroppedFiles([]);
  }, []);

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
            <div className={styles.dragTitle}>释放文件以查看信息</div>
            <div className={styles.dragSubtitle}>
              支持多文件拖放，将按文件名排序显示
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
              <div className={styles.fileStats}>
                文件信息已记录到控制台，可按 F12 查看详细日志
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
