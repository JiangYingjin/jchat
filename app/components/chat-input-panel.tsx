import React, { useRef } from "react";
import clsx from "clsx";
import { useDebouncedCallback } from "use-debounce";
import { isEmpty } from "lodash-es";

import SendWhiteIcon from "../icons/send-white.svg";

import { ChatActions } from "./chat-actions";
import { DeleteImageButton } from "./ui-lib";
import { IconButton } from "./button";
import { showImageModal } from "./ui-lib";
import { copyImageToClipboard } from "../utils/image";

import styles from "./chat.module.scss";

export interface ChatInputPanelProps {
  // ChatActions 相关
  uploadImage: () => Promise<void>;
  capturePhoto: () => Promise<void>;
  uploading: boolean;
  setUserInput: (input: string) => void;
  setAttachImages: (images: string[]) => void;
  userInput: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onInput: (text: string, event?: React.FormEvent<HTMLTextAreaElement>) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handlePaste: (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => Promise<void>;
  inputRows: number;
  autoFocus: boolean;

  // 附件图片相关
  attachImages: string[];
  saveChatInputImages: (images: string[]) => Promise<void>;

  // 保存相关函数
  saveChatInputText: ReturnType<typeof useDebouncedCallback>;
  saveChatInputSelection: (selection: {
    start: number;
    end: number;
  }) => Promise<void>;
  saveChatInputScrollTop: (scrollTop: number) => Promise<void>;

  // 提交函数
  doSubmit: (input: string) => void;
}

export function ChatInputPanel(props: ChatInputPanelProps) {
  const {
    uploadImage,
    capturePhoto,
    uploading,
    setUserInput,
    setAttachImages,
    userInput,
    inputRef,
    onInput,
    onInputKeyDown,
    handlePaste,
    inputRows,
    autoFocus,
    attachImages,
    saveChatInputImages,
    saveChatInputText,
    saveChatInputSelection,
    saveChatInputScrollTop,
    doSubmit,
  } = props;

  return (
    <div className={styles["chat-input-panel"]}>
      <ChatActions
        uploadImage={uploadImage}
        capturePhoto={capturePhoto}
        uploading={uploading}
      />
      <label
        className={clsx(styles["chat-input-panel-inner"], {
          [styles["chat-input-panel-inner-attach"]]: attachImages.length !== 0,
        })}
        htmlFor="chat-input"
      >
        <textarea
          id="chat-input"
          ref={inputRef}
          className={styles["chat-input"]}
          defaultValue={userInput}
          onInput={(e) => onInput(e.currentTarget.value, e)}
          onKeyDown={onInputKeyDown}
          onPaste={handlePaste}
          rows={inputRows}
          autoFocus={autoFocus}
          onBlur={() => {
            const currentValue = inputRef.current?.value ?? "";
            setUserInput(currentValue);
            saveChatInputText.flush && saveChatInputText.flush();
            // 保存光标位置
            if (inputRef.current) {
              const selectionStart = inputRef.current.selectionStart;
              const selectionEnd = inputRef.current.selectionEnd;
              saveChatInputSelection({
                start: selectionStart,
                end: selectionEnd,
              });
            }
          }}
          onScroll={(e) => {
            const scrollTop = e.currentTarget.scrollTop;
            saveChatInputScrollTop(scrollTop);
          }}
          onSelect={(e) => {
            // 光标选择变化时立即保存
            const selectionStart = e.currentTarget.selectionStart;
            const selectionEnd = e.currentTarget.selectionEnd;
            saveChatInputSelection({
              start: selectionStart,
              end: selectionEnd,
            });
          }}
          onMouseUp={(e) => {
            // 鼠标释放时保存光标位置（处理拖拽选择）
            const selectionStart = e.currentTarget.selectionStart;
            const selectionEnd = e.currentTarget.selectionEnd;
            saveChatInputSelection({
              start: selectionStart,
              end: selectionEnd,
            });
          }}
          onKeyUp={(e) => {
            // 键盘释放时保存光标位置（处理键盘导航选择）
            const selectionStart = e.currentTarget.selectionStart;
            const selectionEnd = e.currentTarget.selectionEnd;
            saveChatInputSelection({
              start: selectionStart,
              end: selectionEnd,
            });
          }}
        />
        {attachImages.length != 0 && (
          <div className={styles["attach-images"]}>
            {attachImages.map((image, index) => {
              return (
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
                    copyImageToClipboard(image);
                    e.stopPropagation();
                  }}
                >
                  <div className={styles["attach-image-mask"]}>
                    <DeleteImageButton
                      deleteImage={async () => {
                        const newImages = attachImages.filter(
                          (_, i) => i !== index,
                        );
                        setAttachImages(newImages);
                        await saveChatInputImages(newImages);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <IconButton
          icon={<SendWhiteIcon />}
          className={styles["chat-input-send"]}
          type="primary"
          onClick={() => doSubmit(userInput)}
        />
      </label>
    </div>
  );
}
