import React, { useRef, useEffect } from "react";
import clsx from "clsx";
import styles from "./chat.module.scss";
import { DeleteImageButton } from "./chat";
import { copyImageToClipboard } from "../utils/image";
import { showImageModal } from "./ui-lib";
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY } from "../constant";

interface MessageContentEditPanelProps {
  value: string;
  images: string[];
  onChange: (content: string, images: string[]) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  uploading?: boolean;
  setUploading?: (uploading: boolean) => void;
  handlePaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onConfirm?: () => void;
}

export const MessageContentEditPanel: React.FC<
  MessageContentEditPanelProps
> = ({
  value,
  images,
  onChange,
  textareaRef,
  uploading,
  setUploading,
  handlePaste,
  onConfirm,
}) => {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef || localTextareaRef;

  useEffect(() => {
    if (ref.current) {
      ref.current.value = value;
    }
  }, [value, ref]);

  // 自动聚焦
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
    }
  }, [ref]);

  return (
    <label
      className={clsx(styles["system-prompt-input-panel"], {
        [styles["system-prompt-input-panel-attach"]]: images.length !== 0,
      })}
    >
      <textarea
        ref={ref}
        className={styles["system-prompt-input"]}
        value={value}
        onChange={(e) => onChange(e.target.value, images)}
        onPaste={handlePaste}
        style={{
          fontSize: DEFAULT_FONT_SIZE,
          fontFamily: DEFAULT_FONT_FAMILY,
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            onConfirm?.();
          }
        }}
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
                showImageModal(image, false); // 使用灯箱展示图片
              }}
              onContextMenu={(e) => {
                e.preventDefault(); // 阻止默认右键菜单
                e.stopPropagation();
                copyImageToClipboard(image);
              }}
            >
              <div className={styles["attach-image-mask"]}>
                <DeleteImageButton
                  deleteImage={() => {
                    const newImages = images.filter((_, i) => i !== index);
                    onChange(value, newImages);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </label>
  );
};
