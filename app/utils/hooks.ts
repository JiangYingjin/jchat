import { useRef, useEffect, useState, useCallback } from "react";
import { RefObject } from "react";
import { showToast } from "../components/ui-lib";
import { uploadImage as uploadImageRemote } from "./chat";
import { useChatStore } from "../store";

/**
 * 封装了判断键盘事件是否应该触发表单提交的逻辑
 */
export function useSubmitHandler() {
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;

    // Shift + Enter 用于换行，不发送
    if (e.shiftKey) return false;

    // Enter 或 Ctrl + Enter 发送
    return !e.altKey && !e.metaKey;
  };

  return {
    shouldSubmit,
  };
}

/**
 * 管理聊天窗口的自动滚动行为
 */
export function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  const [autoScroll, setAutoScroll] = useState(true);

  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

/**
 * 实现了一个自定义的三击事件监听器
 */
export function useTripleClick(
  messageEditRef: React.RefObject<HTMLElement | null>,
) {
  const [lastClickTime, setLastClickTime] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [lastClickX, setLastClickX] = useState(0);
  const [lastClickY, setLastClickY] = useState(0);

  const handleClick = (
    e: React.MouseEvent,
    callback: (select: { anchorText: string; extendText: string }) => void,
  ) => {
    const now = Date.now();
    const currentX = e.clientX;
    const currentY = e.clientY;

    setLastClickTime(now);
    setLastClickX(currentX);
    setLastClickY(currentY);

    // 定义点击位置的最大允许偏差（像素）
    const MAX_POSITION_DIFF = 1;

    // 检查点击位置是否相近
    const isPositionClose =
      Math.abs(currentX - lastClickX) <= MAX_POSITION_DIFF &&
      Math.abs(currentY - lastClickY) <= MAX_POSITION_DIFF;

    if (now - lastClickTime > 300 || !isPositionClose) {
      // 如果时间间隔过长或位置相差太大，重置计数
      setClickCount(1);
    } else {
      // 只有在位置相近时才增加计数
      setClickCount((prev) => prev + 1);

      const selection = window.getSelection();

      if (clickCount === 2) {
        // 第三次点击
        setClickCount(0);
        const anchorText = selection?.anchorNode?.textContent;
        const extendText = selection?.focusNode?.textContent;

        console.log("👆 [DEBUG] 三击事件触发:", {
          anchorText:
            anchorText?.substring(0, 50) +
            (anchorText && anchorText.length > 50 ? "..." : ""),
          extendText:
            extendText?.substring(0, 50) +
            (extendText && extendText.length > 50 ? "..." : ""),
          position: { x: currentX, y: currentY },
          timestamp: performance.now(),
        });

        callback({
          anchorText: anchorText ?? "",
          extendText: extendText ?? "",
        });
      }
    }
  };

  return handleClick;
}

/**
 * 封装了从剪贴板粘贴并上传图片的逻辑
 */
export function usePasteImageUpload(
  attachImages: string[],
  setAttachImages: (images: string[]) => void,
  setUploading: (uploading: boolean) => void,
  onContentChange?: (content: string) => void,
  getCurrentContent?: () => string, // 🔥 新增参数：获取当前内容的函数
) {
  const chatStore = useChatStore();

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // 🔍 立即尝试获取当前内容
      let currentContentAtPaste = "";
      if (getCurrentContent) {
        try {
          currentContentAtPaste = getCurrentContent();
        } catch (error) {}
      }

      const currentModel = chatStore.currentSession().model;
      const items = event.clipboardData?.items;
      const imageFiles: File[] = [];

      // 收集所有图片文件
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }
      }

      // 如果有图片文件，处理上传
      if (imageFiles.length > 0) {
        event.preventDefault();
        const images: string[] = [];
        images.push(...attachImages);

        try {
          setUploading(true);
          console.log("📤 [usePasteImageUpload] 开始上传图像:", {
            filesCount: imageFiles.length,
            currentImagesCount: attachImages.length,
          });

          const uploadPromises = imageFiles.map((file) =>
            uploadImageRemote(file),
          );
          const uploadedImages = await Promise.all(uploadPromises);
          images.push(...uploadedImages);

          console.log("✅ [usePasteImageUpload] 图像上传成功，更新图像列表:", {
            uploadedCount: uploadedImages.length,
            totalImagesAfter: images.length,
            uploadedImages,
          });

          // 🔥 关键修复：图像上传成功后，同时保持文本内容和更新图像
          if (getCurrentContent) {
            const currentContent = getCurrentContent();

            // 🔥 关键修复：使用专门的回调函数，同时传递内容和图像，避免分离状态更新
            if (onContentChange) {
              onContentChange(currentContent);
            }
          }

          // 更新图像列表
          setAttachImages(images);
        } catch (e) {
          console.error("上传粘贴图片失败:", e);
          showToast("图片上传失败，请重试");
        } finally {
          setUploading(false);
        }
      }

      // 粘贴文本后，确保内容及时更新
      if (onContentChange) {
        setTimeout(() => {
          if (event.currentTarget) {
            onContentChange(event.currentTarget.value);
          }
        }, 0);
      }
    },
    [
      attachImages,
      chatStore,
      setAttachImages,
      setUploading,
      onContentChange,
      getCurrentContent,
    ],
  );

  return handlePaste;
}
