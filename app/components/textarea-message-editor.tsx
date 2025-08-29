import React, { useRef, useEffect, useCallback, useMemo } from "react";
import clsx from "clsx";
import styles from "../styles/chat.module.scss";
import monacoStyles from "../styles/monaco-editor.module.scss";
import { DeleteImageButton } from "./button";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "./ui-lib";
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY } from "../constant";
import {
  useUncontrolledTextarea,
  useTextMemoryMonitor,
  useThrottle,
} from "../utils/performance-hooks";

interface TextareaMessageEditorProps {
  value: string;
  images: string[];
  onChange: (content: string, images: string[]) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  handlePaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onConfirm?: () => void;
}

const TextareaMessageEditorComponent: React.FC<TextareaMessageEditorProps> = ({
  value,
  images,
  onChange,
  textareaRef,
  handlePaste,
  onConfirm,
}) => {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 🚀 性能优化：使用非受控组件避免大文本渲染问题
  const {
    textareaRef: uncontrolledRef,
    handleInput,
    setValue,
    getValue,
  } = useUncontrolledTextarea(
    value,
    useCallback(
      (newValue: string) => {
        onChange(newValue, images);
      },
      [onChange, images],
    ),
  );

  // 使用传入的ref或内部ref
  const finalRef = textareaRef || uncontrolledRef || localTextareaRef;

  // 🚀 性能优化：节流处理选择和滚动事件
  const throttledOnSelect = useThrottle(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      // 处理文本选择事件，避免高频触发
    },
    100,
  );

  const throttledOnScroll = useThrottle(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      // 处理滚动事件，避免高频触发
    },
    50,
  );

  // 🚀 性能优化：稳定的事件处理函数
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        onConfirm?.();
      }
    },
    [onConfirm],
  );

  const handlePasteOptimized = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // 对于大文本粘贴，延迟处理以避免UI阻塞
      if (handlePaste) {
        const pasteData = e.clipboardData.getData("text");
        if (pasteData.length > 50000) {
          // 大文本粘贴延迟处理
          setTimeout(() => {
            handlePaste(e);
          }, 100);
        } else {
          handlePaste(e);
        }
      }
    },
    [handlePaste],
  );

  // 当外部value变化时更新内部值
  useEffect(() => {
    setValue(value);
  }, [value, setValue]);

  // 🚀 性能优化：自动聚焦优化
  useEffect(() => {
    if (finalRef.current) {
      // 延迟聚焦，避免阻塞初始渲染
      const timer = setTimeout(() => {
        if (finalRef.current) {
          finalRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [finalRef]); // 包含finalRef依赖，但由于ref逻辑，实际不会造成频繁重新执行

  // 🚀 性能优化：图片删除处理函数缓存
  const imageDeleteHandlers = useMemo(() => {
    return images.map((_, index) => () => {
      const newImages = images.filter((_, i) => i !== index);
      onChange(getValue(), newImages);
    });
  }, [images, onChange, getValue]);

  // 🚀 性能优化：样式对象缓存
  const textareaStyle = useMemo(
    () => ({
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: DEFAULT_FONT_FAMILY,
    }),
    [],
  );

  // 🚀 性能优化：类名缓存
  const panelClassName = useMemo(
    () =>
      clsx(monacoStyles["system-prompt-input-panel"], {
        [monacoStyles["system-prompt-input-panel-attach"]]: images.length !== 0,
      }),
    [images.length],
  );

  return (
    <label className={panelClassName}>
      <textarea
        ref={finalRef}
        className={styles["system-prompt-input"]}
        defaultValue={value} // 🚀 使用defaultValue而非value，避免受控组件性能问题
        onInput={handleInput} // 🚀 使用onInput而非onChange，获得更好的性能
        onPaste={handlePasteOptimized}
        onSelect={throttledOnSelect}
        onScroll={throttledOnScroll}
        style={textareaStyle}
        onKeyDown={handleKeyDown}
        autoFocus
      />

      {images.length !== 0 && (
        <div className={styles["attach-images"]}>
          {images.map((image, index) => (
            <div
              key={index}
              className={styles["attach-image"]}
              style={{ backgroundImage: `url("${image}")` }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                showImageModal(image, false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                copyImageToClipboard(image);
              }}
            >
              <div className={styles["attach-image-mask"]}>
                <DeleteImageButton deleteImage={imageDeleteHandlers[index]} />
              </div>
            </div>
          ))}
        </div>
      )}
    </label>
  );
};

// 使用React.memo进行性能优化，避免不必要的重新渲染
export const TextareaMessageEditor = React.memo(TextareaMessageEditorComponent);
TextareaMessageEditor.displayName = "MessageContentEditPanel";
