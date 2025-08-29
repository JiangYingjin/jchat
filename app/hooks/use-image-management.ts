import { useMemo, useCallback } from "react";
import clsx from "clsx";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "../components/ui-lib";

export interface ImageManagementOptions {
  images: string[];
  value: string;
  onChange: (content: string, images: string[]) => void;
}

/**
 * 图片管理 Hook
 * 提供图片删除、预览、复制等功能
 */
export function useImageManagement({
  images,
  value,
  onChange,
}: ImageManagementOptions) {
  // 🚀 性能优化：图片删除处理函数缓存
  const imageDeleteHandlers = useMemo(() => {
    return images.map((_, index) => () => {
      console.log("🗑️ [Image] 图像删除处理开始:", {
        deleteIndex: index,
        totalImages: images.length,
        currentValue:
          value?.substring(0, 100) + (value?.length > 100 ? "..." : ""),
        valueLength: value?.length || 0,
      });

      const newImages = images.filter((_, i) => i !== index);

      console.log("🗑️ [Image] 调用onChange with:", {
        valueLength: value?.length || 0,
        newImagesCount: newImages.length,
        originalImagesCount: images.length,
      });

      onChange(value, newImages);
    });
  }, [images, onChange, value]);

  // 🚀 性能优化：类名缓存
  const panelClassName = useMemo(
    () =>
      clsx(monacoStyles["system-prompt-input-panel"], {
        [monacoStyles["system-prompt-input-panel-attach"]]: images.length !== 0,
      }),
    [images.length],
  );

  // 图片点击处理函数（预览）
  const handleImageClick = useCallback((image: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showImageModal(image, false);
    };
  }, []);

  // 图片右键菜单处理函数（复制）
  const handleImageContextMenu = useCallback((image: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      copyImageToClipboard(image);
    };
  }, []);

  // 图片预览处理函数
  const handleImagePreview = useCallback((image: string) => {
    showImageModal(image, false);
  }, []);

  // 图片复制处理函数
  const handleImageCopy = useCallback((image: string) => {
    copyImageToClipboard(image);
  }, []);

  return {
    // 数据
    imageDeleteHandlers,
    panelClassName,

    // 处理函数
    handleImageClick,
    handleImageContextMenu,
    handleImagePreview,
    handleImageCopy,
  };
}
