import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
  RefObject,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";
import VoiceOpenIcon from "../icons/voice-open.svg";
import VoiceCloseIcon from "../icons/voice-close.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import SpeakIcon from "../icons/speak.svg";
import SpeakStopIcon from "../icons/speak-stop.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import MaskIcon from "../icons/mask.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import SettingsIcon from "../icons/chat-settings.svg";
import DeleteIcon from "../icons/clear.svg";
import PinIcon from "../icons/pin.svg";
import EditIcon from "../icons/edit.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import EnablePluginIcon from "../icons/plugin_enable.svg";
import DisablePluginIcon from "../icons/plugin_disable.svg";
import UploadIcon from "../icons/upload.svg";
import ImageIcon from "../icons/image.svg";
import CameraIcon from "../icons/camera.svg";

import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";
import CheckmarkIcon from "../icons/checkmark.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import StyleIcon from "../icons/palette.svg";
import PluginIcon from "../icons/plugin.svg";
import ShortcutkeyIcon from "../icons/shortcutkey.svg";
import ReloadIcon from "../icons/reload.svg";
import HeadphoneIcon from "../icons/headphone.svg";
import SearchCloseIcon from "../icons/search_close.svg";
import SearchOpenIcon from "../icons/search_open.svg";
import EnableThinkingIcon from "../icons/thinking_enable.svg";
import DisableThinkingIcon from "../icons/thinking_disable.svg";
import BackgroundIcon from "../icons/background.svg";
import {
  ChatMessage,
  useChatStore,
  BOT_HELLO,
  createMessage,
  useAccessStore,
  Theme,
  useAppConfig,
  DEFAULT_TOPIC,
  ModelType,
  usePluginStore,
  systemMessageStorage,
} from "../store";

import {
  copyToClipboard,
  selectOrCopy,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageTextReasoningContent,
  getMessageImages,
  isVisionModel,
  isOpenAIImageGenerationModel,
  showPlugins,
  safeLocalStorage,
  isSupportRAGModel,
  isFunctionCallModel,
  isFirefox,
  isClaudeThinkingModel,
  isGPTImageModel,
  isDalle3,
} from "../utils";

import { uploadImage as uploadImageRemote } from "@/app/utils/chat";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";
import {
  DalleSize,
  DalleQuality,
  DalleStyle,
  GPTImageQuality,
  GPTImageSize,
  GPTImageBackground,
} from "../typing";
import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  SearchSelector,
  Selector,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  DEFAULT_STT_ENGINE,
  DEFAULT_TTS_ENGINE,
  FIREFOX_DEFAULT_STT_ENGINE,
  ModelProvider,
  Path,
  REQUEST_TIMEOUT_MS,
  CHAT_INPUT_TEXT,
  CHAT_INPUT_IMAGES,
  CHAT_INPUT_SCROLL_TOP,
  ServiceProvider,
} from "../constant";
import { Avatar } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
import { useAllModels } from "../utils/hooks";
import { MultimodalContent } from "../client/api";

import { ClientApi } from "../client/api";
import { createTTSPlayer } from "../utils/audio";
import { MsEdgeTTS, OUTPUT_FORMAT } from "../utils/ms_edge_tts";

import { isEmpty } from "lodash-es";
import { getModelProvider } from "../utils/model";
import clsx from "clsx";

import {
  OpenAITranscriptionApi,
  SpeechApi,
  WebTranscriptionApi,
} from "../utils/speech";
import { FileInfo } from "../client/platforms/utils";
import { ThinkingContent } from "./thinking-content";

const ttsPlayer = createTTSPlayer();

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

export function SessionConfigModel(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const maskStore = useMaskStore();
  const navigate = useNavigate();

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              navigate(Path.Masks);
              setTimeout(() => {
                maskStore.create(session.mask);
              }, 500);
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          updateMask={(updater) => {
            const mask = { ...session.mask };
            updater(mask);
            chatStore.updateTargetSession(
              session,
              (session) => (session.mask = mask),
            );
          }}
          shouldSyncFromGlobal
          extraListItems={
            // 移除历史摘要显示，因为已禁用总结功能
            <></>
          }
        ></MaskConfig>
      </Modal>
    </div>
  );
}

function PromptToast(props: {
  showToast?: boolean;
  showModal?: boolean;
  setShowModal: (_: boolean) => void;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const context = session.mask.context;

  return (
    <div className={styles["prompt-toast"]} key="prompt-toast">
      {props.showToast && context.length > 0 && (
        <div
          className={clsx(styles["prompt-toast-inner"], "clickable")}
          role="button"
          onClick={() => props.setShowModal(true)}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
        </div>
      )}
      {props.showModal && (
        <SessionConfigModel onClose={() => props.setShowModal(false)} />
      )}
    </div>
  );
}

function useSubmitHandler() {
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

export type RenderPrompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPrompt[];
  onPromptSelect: (prompt: RenderPrompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={clsx(styles["prompt-hint"], {
            [styles["prompt-hint-selected"]]: i === selectIndex,
          })}
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

function ChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean; // 新增参数，控制是否总是 full 宽度
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useEffect(() => {
    if (props.alwaysFullWidth) {
      updateWidth();
    }
  }, [props.text, props.icon, props.alwaysFullWidth]);

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={() => {
        if (props.loding) return;
        props.onClick();
        iconRef ? setTimeout(updateWidth, 1) : undefined;
      }}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && props.text}
      </div>
      {props.innerNode}
    </div>
  );
}

// 新增：双击确认的 ChatAction 组件
function DoubleClickChatAction(props: {
  text: string;
  icon?: JSX.Element;
  loding?: boolean;
  innerNode?: JSX.Element;
  onClick: () => void;
  style?: React.CSSProperties;
  alwaysFullWidth?: boolean;
  confirmText?: string; // 确认时的文本
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });
  const [clickCount, setClickCount] = useState(0);
  const [isConfirmed, setIsConfirmed] = useState(false);

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  // 计算最终宽度
  const iconWidthValue = width.icon;
  const fullWidthValue = width.full;
  const style =
    props.icon && !props.loding
      ? ({
          "--icon-width": `${iconWidthValue}px`,
          "--full-width": `${fullWidthValue}px`,
          ...props.style,
          ...(props.alwaysFullWidth ? { width: `${fullWidthValue}px` } : {}),
          // 当确认时改变样式
          ...(isConfirmed
            ? {
                backgroundColor: "var(--primary-light, #e6f0fa)",
                color: "var(--primary, #2196f3)",
                border: "1.5px solid var(--primary)",
              }
            : {}),
        } as React.CSSProperties)
      : props.loding
        ? ({
            "--icon-width": `30px`,
            "--full-width": `30px`,
            ...props.style,
            ...(props.alwaysFullWidth ? { width: `30px` } : {}),
          } as React.CSSProperties)
        : props.style;

  // 保证 alwaysFullWidth 时宽度总是最新
  useEffect(() => {
    if (props.alwaysFullWidth) {
      updateWidth();
    }
  }, [props.text, props.icon, props.alwaysFullWidth]);

  const handleClick = () => {
    if (props.loding) return;

    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);

    if (newClickCount === 1) {
      // 第一次点击，显示确认状态
      setIsConfirmed(true);
      // 3秒后自动重置
      setTimeout(() => {
        setClickCount(0);
        setIsConfirmed(false);
      }, 3000);
    } else if (newClickCount === 2) {
      // 第二次点击，执行操作
      props.onClick();
      setClickCount(0);
      setIsConfirmed(false);
    }
  };

  const handleMouseLeave = () => {
    // 鼠标移出时重置状态
    setClickCount(0);
    setIsConfirmed(false);
  };

  const displayText = isConfirmed ? props.confirmText || "重试" : props.text;

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable")}
      onClick={handleClick}
      onMouseEnter={props.icon ? updateWidth : undefined}
      onMouseLeave={handleMouseLeave}
      onTouchStart={props.icon ? updateWidth : undefined}
      style={style}
    >
      {props.icon ? (
        <div ref={iconRef} className={styles["icon"]}>
          {props.loding ? <LoadingIcon /> : props.icon}
        </div>
      ) : null}
      <div
        className={
          props.icon && !props.loding
            ? `${styles["text"]}${props.alwaysFullWidth ? " " + styles["text-always-show"] : ""}`
            : undefined
        }
        ref={textRef}
      >
        {!props.loding && displayText}
      </div>
      {props.innerNode}
    </div>
  );
}

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  // for auto-scroll

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

export function ChatActions(props: {
  uploadImage: () => Promise<void>;
  capturePhoto: () => Promise<void>;
  setAttachImages: (images: string[]) => void;
  uploadFile: () => Promise<void>;
  setAttachFiles: (files: FileInfo[]) => void;
  setUploading: (uploading: boolean) => void;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setShowShortcutKeyModal: React.Dispatch<React.SetStateAction<boolean>>;
  setUserInput: (input: string) => void;
  setShowChatSidePanel: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const config = useAppConfig();
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const pluginStore = usePluginStore();
  const session = chatStore.currentSession();

  // switch thinking mode
  const claudeThinking = chatStore.currentSession().mask.claudeThinking;
  function switchClaudeThinking() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.claudeThinking = !session.mask.claudeThinking;
    });
  }

  // switch web search
  const webSearch = chatStore.currentSession().mask.webSearch;
  function switchWebSearch() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.webSearch =
        !session.mask.webSearch &&
        !isFunctionCallModel(currentModel) &&
        isEnableWebSearch;
    });
  }

  // switch Plugins
  const usePlugins = chatStore.currentSession().mask.usePlugins;
  function switchUsePlugins() {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.usePlugins = !session.mask.usePlugins;
    });
  }

  // switch themes
  const theme = config.theme;
  function nextTheme() {
    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
    const themeIndex = themes.indexOf(theme);
    const nextIndex = (themeIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    config.update((config) => (config.theme = nextTheme));
  }

  // stop all responses
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // switch model
  const currentModel = session.mask.modelConfig.model;
  const currentProviderName =
    session.mask.modelConfig?.providerName || ServiceProvider.OpenAI;
  const allModels = useAllModels();
  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    const defaultModel = filteredModels.find((m) => m.isDefault);

    const groupedModels = filteredModels.sort((a, b) => {
      const providerA = a.provider?.providerName || "";
      const providerB = b.provider?.providerName || "";
      return providerA.localeCompare(providerB);
    });

    if (defaultModel) {
      const arr = [
        defaultModel,
        ...groupedModels.filter((m) => m !== defaultModel),
      ];
      return arr;
    } else {
      return groupedModels;
    }
  }, [allModels]);

  const currentModelName = useMemo(() => {
    const model = models.find(
      (m) =>
        m.name == currentModel &&
        m?.provider?.providerName == currentProviderName,
    );
    return model?.displayName ?? "";
  }, [models, currentModel, currentProviderName]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);
  const [showUploadFile, setShowUploadFile] = useState(false);

  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [showBackgroundSelector, setShowBackgroundSelector] = useState(false);
  const dalle3Sizes: DalleSize[] = ["1024x1024", "1792x1024", "1024x1792"];
  const dalle3Qualitys: DalleQuality[] = ["standard", "hd"];
  const gptImageSizes: GPTImageSize[] = [
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
  ];
  const gptImageQualitys: GPTImageQuality[] = ["auto", "high", "medium", "low"];
  const gptImageBackgrounds: GPTImageBackground[] = [
    "auto",
    "transparent",
    "opaque",
  ];
  const dalle3Styles: DalleStyle[] = ["vivid", "natural"];
  const currentSize = session.mask.modelConfig?.size ?? "1024x1024";
  const currentQuality = session.mask.modelConfig?.quality ?? "standard";
  const currentStyle = session.mask.modelConfig?.style ?? "vivid";
  const currentBackground = session.mask.modelConfig?.background ?? "auto";

  const isMobileScreen = useMobileScreen();

  const accessStore = useAccessStore();
  const isEnableRAG = useMemo(
    () => accessStore.enableRAG(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const isDisableModelProviderDisplay = useMemo(
    () => accessStore.isDisableModelProviderDisplay(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const isEnableWebSearch = useMemo(
    () => accessStore.enableWebSearch(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (isGPTImageModel(currentModel)) {
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.size = "auto";
        session.mask.modelConfig.quality = "auto";
        session.mask.modelConfig.style = undefined;
        session.mask.modelConfig.background = "auto";
      });
    }
    if (isDalle3(currentModel)) {
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.size = "1024x1024";
        session.mask.modelConfig.quality = "standard";
        session.mask.modelConfig.style = "vivid";
        session.mask.modelConfig.background = undefined;
      });
    }
  }, [currentModel]);

  useEffect(() => {
    const show = isVisionModel(currentModel);
    setShowUploadImage(show && isMobileScreen);
    setShowUploadFile(isEnableRAG && isSupportRAGModel(currentModel));
    if (!show) {
      props.setAttachImages([]);
      props.setUploading(false);
    }

    // if current model is not available
    // switch to first available model
    const isUnavailableModel = !models.some((m) => m.name === currentModel);
    if (isUnavailableModel && models.length > 0) {
      // show next model to default model if exist
      let nextModel = models.find((model) => model.isDefault) || models[0];
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.model = nextModel.name;
        session.mask.modelConfig.providerName = nextModel?.provider
          ?.providerName as ServiceProvider;
      });
      // showToast(
      //   nextModel?.provider?.providerName == "ByteDance"
      //     ? nextModel.displayName
      //     : nextModel.name,
      //   undefined,
      //   1000,
      // );
    }
  }, [chatStore, currentModel, models, session]);

  return (
    <div className={styles["chat-input-actions"]}>
      <>
        {showUploadImage && (
          <ChatAction
            onClick={props.capturePhoto}
            text="拍照上传"
            icon={props.uploading ? <LoadingButtonIcon /> : <CameraIcon />}
            alwaysFullWidth={false}
          />
        )}
        {showUploadImage && (
          <ChatAction
            onClick={props.uploadImage}
            text={Locale.Chat.InputActions.UploadImage}
            icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
            alwaysFullWidth={false}
          />
        )}
        {showUploadFile && (
          <ChatAction
            onClick={props.uploadFile}
            text={Locale.Chat.InputActions.UploadFle}
            icon={props.uploading ? <LoadingButtonIcon /> : <UploadIcon />}
            alwaysFullWidth={false}
          />
        )}
        {/* <ChatAction
          onClick={nextTheme}
          text={Locale.Chat.InputActions.Theme[theme]}
          icon={
            <>
              {theme === Theme.Auto ? (
                <AutoIcon />
              ) : theme === Theme.Light ? (
                <LightIcon />
              ) : theme === Theme.Dark ? (
                <DarkIcon />
              ) : null}
            </>
          }
        />

        <ChatAction
          onClick={props.showPromptHints}
          text={Locale.Chat.InputActions.Prompt}
          icon={<PromptIcon />}
        />

        <ChatAction
          onClick={() => {
            navigate(Path.Masks);
          }}
          text={Locale.Chat.InputActions.Masks}
          icon={<MaskIcon />}
        />

        <ChatAction
          text={Locale.Chat.InputActions.Clear}
          icon={<BreakIcon />}
          onClick={() => {
            chatStore.updateTargetSession(session, (session) => {
              if (session.clearContextIndex === session.messages.length) {
                session.clearContextIndex = undefined;
              } else {
                session.clearContextIndex = session.messages.length;
                session.memoryPrompt = ""; // will clear memory
              }
            });
          }}
        /> */}

        {config.pluginConfig.enable && isFunctionCallModel(currentModel) && (
          <ChatAction
            onClick={switchUsePlugins}
            text={
              usePlugins
                ? Locale.Chat.InputActions.DisablePlugins
                : Locale.Chat.InputActions.EnablePlugins
            }
            icon={usePlugins ? <EnablePluginIcon /> : <DisablePluginIcon />}
            alwaysFullWidth={false}
          />
        )}

        <ChatAction
          onClick={() => setShowModelSelector(true)}
          text={currentModelName}
          icon={<RobotIcon />}
          alwaysFullWidth={true}
        />
        {!isMobileScreen && (
          <ChatAction
            onClick={() => {
              chatStore.updateTargetSession(session, (s) => {
                s.longInputMode = !s.longInputMode;
              });
            }}
            text={"长输入模式"}
            icon={<EditIcon />}
            alwaysFullWidth={false}
            style={{
              backgroundColor: session.longInputMode
                ? "var(--primary-light, #e6f0fa)"
                : undefined,
              color: session.longInputMode
                ? "var(--primary, #2196f3)"
                : undefined,
              opacity: session.longInputMode ? 1 : 0.7,
              border: session.longInputMode
                ? "1.5px solid var(--primary)"
                : undefined,
            }}
          />
        )}

        {/* {!isFunctionCallModel(currentModel) &&
          isEnableWebSearch &&
          !isOpenAIImageGenerationModel(currentModel) && (
            <ChatAction
              onClick={switchWebSearch}
              text={
                webSearch
                  ? Locale.Chat.InputActions.CloseWebSearch
                  : Locale.Chat.InputActions.OpenWebSearch
              }
              icon={webSearch ? <SearchOpenIcon /> : <SearchCloseIcon />}
              alwaysFullWidth={false}
            />
          )} */}

        {isClaudeThinkingModel(currentModel) && (
          <ChatAction
            onClick={switchClaudeThinking}
            text={
              claudeThinking
                ? Locale.Chat.InputActions.DisableThinking
                : Locale.Chat.InputActions.EnableThinking
            }
            icon={
              claudeThinking ? <EnableThinkingIcon /> : <DisableThinkingIcon />
            }
            alwaysFullWidth={false}
          />
        )}

        {showModelSelector && (
          <SearchSelector
            defaultSelectedValue={`${currentModel}@${currentProviderName}`}
            items={models.map((m) => ({
              title: `${m.displayName}${
                m?.provider?.providerName && !isDisableModelProviderDisplay
                  ? "(" + m?.provider?.providerName + ")"
                  : ""
              }`,
              value: `${m.name}@${m?.provider?.providerName}`,
            }))}
            onClose={() => setShowModelSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const [model, providerName] = getModelProvider(s[0]);
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.model = model as ModelType;
                session.mask.modelConfig.providerName =
                  providerName as ServiceProvider;
                session.mask.syncGlobalConfig = false;
              });
              // if (providerName == "ByteDance") {
              //   const selectedModel = models.find(
              //     (m) =>
              //       m.name == model &&
              //       m?.provider?.providerName == providerName,
              //   );
              //   showToast(selectedModel?.displayName ?? "", undefined, 1000);
              // } else {
              //   showToast(model, undefined, 1000);
              // }
            }}
          />
        )}

        {isOpenAIImageGenerationModel(currentModel) && (
          <ChatAction
            onClick={() => setShowSizeSelector(true)}
            text={currentSize}
            icon={<SizeIcon />}
            alwaysFullWidth={false}
          />
        )}

        {showSizeSelector && (
          <Selector
            defaultSelectedValue={currentSize}
            items={
              isGPTImageModel(currentModel)
                ? gptImageSizes.map((m) => ({
                    title: m,
                    value: m,
                  }))
                : dalle3Sizes.map((m) => ({
                    title: m,
                    value: m,
                  }))
            }
            onClose={() => setShowSizeSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const size = s[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.size = size;
              });
              showToast(size);
            }}
          />
        )}

        {isOpenAIImageGenerationModel(currentModel) && (
          <ChatAction
            onClick={() => setShowQualitySelector(true)}
            text={currentQuality}
            icon={<QualityIcon />}
            alwaysFullWidth={false}
          />
        )}

        {showQualitySelector && (
          <Selector
            defaultSelectedValue={currentQuality}
            items={
              isGPTImageModel(currentModel)
                ? gptImageQualitys.map((m) => ({
                    title: m,
                    value: m,
                  }))
                : dalle3Qualitys.map((m) => ({
                    title: m,
                    value: m,
                  }))
            }
            onClose={() => setShowQualitySelector(false)}
            onSelection={(q) => {
              if (q.length === 0) return;
              const quality = q[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.quality = quality;
              });
              showToast(quality);
            }}
          />
        )}

        {isGPTImageModel(currentModel) && (
          <ChatAction
            onClick={() => setShowBackgroundSelector(true)}
            text={currentBackground}
            icon={<BackgroundIcon />}
            alwaysFullWidth={false}
          />
        )}

        {showBackgroundSelector && (
          <Selector
            defaultSelectedValue={currentBackground}
            items={gptImageBackgrounds.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowBackgroundSelector(false)}
            onSelection={(b) => {
              if (b.length === 0) return;
              const background = b[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.background = background;
              });
              showToast(background);
            }}
          />
        )}

        {!isGPTImageModel(currentModel) &&
          isOpenAIImageGenerationModel(currentModel) && (
            <ChatAction
              onClick={() => setShowStyleSelector(true)}
              text={currentStyle}
              icon={<StyleIcon />}
              alwaysFullWidth={false}
            />
          )}

        {!isGPTImageModel(currentModel) &&
          isOpenAIImageGenerationModel(currentModel) &&
          showStyleSelector && (
            <Selector
              defaultSelectedValue={currentStyle}
              items={dalle3Styles.map((m) => ({
                title: m,
                value: m,
              }))}
              onClose={() => setShowStyleSelector(false)}
              onSelection={(s) => {
                if (s.length === 0) return;
                const style = s[0];
                chatStore.updateTargetSession(session, (session) => {
                  session.mask.modelConfig.style = style;
                });
                showToast(style);
              }}
            />
          )}

        {/* {showPlugins(currentProviderName, currentModel) && (
          <ChatAction
            onClick={() => {
              if (pluginStore.getAll().length == 0) {
                navigate(Path.Plugins);
              } else {
                setShowPluginSelector(true);
              }
            }}
            text={Locale.Plugin.Name}
            icon={<PluginIcon />}
          />
        )} */}
        {showPluginSelector && (
          <Selector
            multiple
            defaultSelectedValue={chatStore.currentSession().mask?.plugin}
            items={pluginStore.getAll().map((item) => ({
              title: `${item?.title}@${item?.version}`,
              value: item?.id,
            }))}
            onClose={() => setShowPluginSelector(false)}
            onSelection={(s) => {
              chatStore.updateTargetSession(session, (session) => {
                session.mask.plugin = s as string[];
              });
            }}
          />
        )}

        {couldStop && (
          <ChatAction
            onClick={stopAll}
            text={Locale.Chat.InputActions.Stop}
            icon={<StopIcon />}
            alwaysFullWidth={false}
          />
        )}
        {/* {!props.hitBottom && (
          <ChatAction
            onClick={props.scrollToBottom}
            text={Locale.Chat.InputActions.ToBottom}
            icon={<BottomIcon />}
          />
        )} */}
        {/* {props.hitBottom && (
          <ChatAction
            onClick={props.showPromptModal}
            text={Locale.Chat.InputActions.Settings}
            icon={<SettingsIcon />}
          />
        )} */}
        {/* {!isMobileScreen && (
          <ChatAction
            onClick={() => props.setShowShortcutKeyModal(true)}
            text={Locale.Chat.ShortcutKey.Title}
            icon={<ShortcutkeyIcon />}
          />
        )} */}
      </>
      <div className={styles["chat-input-actions-end"]}>
        {config.realtimeConfig.enable && (
          <ChatAction
            onClick={() => props.setShowChatSidePanel(true)}
            text={Locale.Settings.Realtime.Enable.Title}
            icon={<HeadphoneIcon />}
            alwaysFullWidth={false}
          />
        )}
      </div>
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => {
              props.onClose();
            }}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              chatStore.updateTargetSession(
                session,
                (session) => (session.messages = messages),
              );
              props.onClose();
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  chatStore.updateTargetSession(
                    session,
                    (session) => (session.topic = e.currentTarget.value),
                  );
                  props.onClose();
                }
              }}
            ></input>
            <IconButton
              icon={<ReloadIcon />}
              bordered
              title={Locale.Chat.Actions.RefreshTitle}
              onClick={() => {
                showToast(Locale.Chat.Actions.RefreshToast);
                chatStore.summarizeSession(true, session);
              }}
            />
          </ListItem>
        </List>
        <ContextPrompts
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
          onModalClose={props.onClose}
        />
      </Modal>
    </div>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
  );
}

export function DeleteFileButton(props: { deleteFile: () => void }) {
  return (
    <div className={styles["delete-file"]} onClick={props.deleteFile}>
      <DeleteIcon />
    </div>
  );
}

export function ShortcutKeyModal(props: { onClose: () => void }) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcuts = [
    {
      title: Locale.Chat.ShortcutKey.newChat,
      keys: isMac ? ["⌘", "Shift", "O"] : ["Ctrl", "Shift", "O"],
    },
    { title: Locale.Chat.ShortcutKey.focusInput, keys: ["Shift", "Esc"] },
    {
      title: Locale.Chat.ShortcutKey.copyLastCode,
      keys: isMac ? ["⌘", "Shift", ";"] : ["Ctrl", "Shift", ";"],
    },
    {
      title: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: isMac ? ["⌘", "Shift", "C"] : ["Ctrl", "Shift", "C"],
    },
    {
      title: Locale.Chat.ShortcutKey.showShortcutKey,
      keys: isMac ? ["⌘", "/"] : ["Ctrl", "/"],
    },
  ];
  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.ShortcutKey.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              props.onClose();
            }}
          />,
        ]}
      >
        <div className={styles["shortcut-key-container"]}>
          <div className={styles["shortcut-key-grid"]}>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className={styles["shortcut-key-item"]}>
                <div className={styles["shortcut-key-title"]}>
                  {shortcut.title}
                </div>
                <div className={styles["shortcut-key-keys"]}>
                  {shortcut.keys.map((key, i) => (
                    <div key={i} className={styles["shortcut-key"]}>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// 修改三击事件处理函数
function useTripleClick(messageEditRef: React.RefObject<HTMLElement>) {
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
        callback({
          anchorText: anchorText ?? "",
          extendText: extendText ?? "",
        });
      }
    }
  };

  return handleClick;
}

// 新增：消息操作按钮组件
function MessageActions(props: {
  message: ChatMessage;
  onResend: (message: ChatMessage) => void;
  onDelete: (msgId: string) => void;
  onUserStop: (messageId: string) => void;
  index: number;
}) {
  const { message, onResend, onDelete, onUserStop, index } = props;

  return (
    <div className={styles["chat-input-actions"]}>
      {message.streaming ? (
        <ChatAction
          text={Locale.Chat.Actions.Stop}
          icon={<StopIcon />}
          onClick={() => onUserStop(message.id ?? index)}
          alwaysFullWidth={false}
        />
      ) : (
        <>
          <DoubleClickChatAction
            text={Locale.Chat.Actions.Retry}
            icon={<ResetIcon />}
            onClick={() => onResend(message)}
            alwaysFullWidth={false}
          />
          <ChatAction
            text={Locale.Chat.Actions.Copy}
            icon={<CopyIcon />}
            onClick={() => copyToClipboard(getMessageTextContent(message))}
            alwaysFullWidth={false}
          />
          <ChatAction
            text={Locale.Chat.Actions.Delete}
            icon={<DeleteIcon />}
            onClick={() => onDelete(message.id ?? index)}
            alwaysFullWidth={false}
          />
        </>
      )}
    </div>
  );
}

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const accessStore = useAccessStore();
  const allModels = useAllModels();

  // 记住未完成输入的防抖保存函数，间隔放宽到 1200ms
  const saveChatInputText = useDebouncedCallback((value: string) => {
    const key = CHAT_INPUT_TEXT(session.id);
    localStorage.setItem(key, value);
    // console.log("[UserInput][Save] 保存未完成输入:", value);
  }, 500);
  // 新增：立即保存 scrollTop
  function saveChatInputScrollTop(scrollTop: number) {
    try {
      const key = CHAT_INPUT_SCROLL_TOP(session.id);
      localStorage.setItem(key, String(scrollTop));
      // console.log("[UserInput][Save] 保存 scrollTop:", scrollTop);
    } catch (e) {
      // console.error("[UserInput][Save] 保存 scrollTop 失败:", e);
    }
  }
  function loadChatInputText(): string {
    try {
      const key = CHAT_INPUT_TEXT(session.id);
      const value = localStorage.getItem(key);
      // console.log("[UserInput][Load] 加载未完成输入:", value);
      return value ?? "";
    } catch (e) {
      // console.error("[UserInput][Load] 加载未完成输入失败:", e);
      return "";
    }
  }
  // 新增：加载 scrollTop
  function loadChatInputScrollTop(): number {
    try {
      const key = CHAT_INPUT_SCROLL_TOP(session.id);
      const value = localStorage.getItem(key);
      if (value) {
        return Number(value);
      }
    } catch (e) {
      // console.error("[UserInput][Load] 加载未完成 scrollTop 失败:", e);
    }
    return 0;
  }
  // 新增：保存和加载未完成图片的方法
  function saveChatInputImages(images: string[]) {
    try {
      const key = CHAT_INPUT_IMAGES(session.id);
      localStorage.setItem(key, JSON.stringify(images));
      // console.log("[UserInput][Save] 保存未完成图片:", images);
    } catch (e) {
      // console.error("[UserInput][Save] 保存未完成图片失败:", e);
    }
  }
  function loadChatInputImages(): string[] {
    try {
      const key = CHAT_INPUT_IMAGES(session.id);
      const raw = localStorage.getItem(key);
      if (raw) {
        const images = JSON.parse(raw);
        if (Array.isArray(images)) {
          // console.log("[UserInput][Load] 加载未完成图片:", images);
          return images;
        }
      }
    } catch (e) {
      // console.error("[UserInput][Load] 加载未完成图片失败:", e);
    }
    return [];
  }

  // 自动修正模型配置
  useEffect(() => {
    // 获取当前模型和 provider
    const { model, providerName, compressModel, compressProviderName } =
      config.modelConfig;
    // 检查主模型是否有效
    const isModelValid = allModels.some(
      (m) =>
        m.name === model &&
        m.provider?.providerName === providerName &&
        m.available,
    );
    // 检查压缩模型是否有效
    const isCompressModelValid = allModels.some(
      (m) =>
        m.name === compressModel &&
        m.provider?.providerName === compressProviderName &&
        m.available,
    );
    // console.log("[updateConfig] isModelValid", isModelValid);
    // console.log("[updateConfig] isCompressModelValid", isCompressModelValid);
    // 如果主模型或压缩模型无效，自动 fetch 并更新为 defaultModel
    if (!isModelValid || !isCompressModelValid) {
      // 拉取服务器配置，获取 defaultModel
      accessStore.fetch();
      // 取最新 defaultModel
      const defaultModelStr = accessStore.defaultModel;
      if (defaultModelStr) {
        const [defaultModel, defaultProvider] =
          getModelProvider(defaultModelStr);
        config.update((cfg) => {
          // 主模型无效时修正
          if (!isModelValid) {
            cfg.modelConfig.model = defaultModel;
            cfg.modelConfig.providerName = defaultProvider as any;
            console.log(
              "[updateConfig] cfg.modelConfig.model",
              cfg.modelConfig.model,
            );
            console.log(
              "[updateConfig] cfg.modelConfig.providerName",
              cfg.modelConfig.providerName,
            );
          }
          // 压缩模型无效时修正
          if (!isCompressModelValid) {
            cfg.modelConfig.compressModel = defaultModel;
            cfg.modelConfig.compressProviderName = defaultProvider as any;
            console.log(
              "[updateConfig] cfg.modelConfig.compressModel",
              cfg.modelConfig.compressModel,
            );
            console.log(
              "[updateConfig] cfg.modelConfig.compressProviderName",
              cfg.modelConfig.compressProviderName,
            );
          }
        });
      }
    }
  }, [accessStore]);

  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageItemRef = useRef<HTMLDivElement>(null);
  const messageEditRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [isLargeInput, setIsLargeInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const isAttachWithTop = useMemo(() => {
    const lastMessage = scrollRef.current?.lastElementChild as HTMLElement;
    // if scrolllRef is not ready or no message, return false
    if (!scrollRef?.current || !lastMessage) return false;
    const topDistance =
      lastMessage!.getBoundingClientRect().top -
      scrollRef.current.getBoundingClientRect().top;
    // leave some space for user question
    return topDistance < 100;
  }, [scrollRef?.current?.scrollHeight]);

  const isTyping = userInput !== "";

  // if user is typing, should auto scroll to bottom
  // if user is not typing, should auto scroll to bottom only if already at bottom
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    (isScrolledToBottom || isAttachWithTop) && !isTyping,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachFiles, setAttachFiles] = useState<FileInfo[]>([]);

  // 移动端默认开启长输入模式
  useEffect(() => {
    if (isMobileScreen && session.longInputMode === false) {
      chatStore.updateTargetSession(session, (session) => {
        session.longInputMode = true;
      });
    }
  }, [isMobileScreen, session.longInputMode, chatStore]);

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateTargetSession(
        session,
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    fork: () => chatStore.forkSession(),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;

  useEffect(() => {
    // try to load from local storage

    // 加载会话文字输入
    const userInputText = loadChatInputText();
    const userInputScrollTop = loadChatInputScrollTop();
    if (inputRef.current) {
      inputRef.current.value = userInputText;
      inputRef.current.scrollTop = userInputScrollTop;
    }
    setUserInput(userInputText);

    // 加载会话图像输入
    const images = loadChatInputImages();
    setAttachImages(images);
  }, []);

  // onInput 只做本地保存和提示词联想，不 setUserInput
  const onInput = (
    text: string,
    event?: React.FormEvent<HTMLTextAreaElement>,
  ) => {
    saveChatInputText(text); // 只防抖保存 text
    // 只要内容有换行或长度变化较大（如粘贴/多行输入），就 setUserInput
    if (
      text.includes("\n") ||
      (userInput && Math.abs(text.length - userInput.length) > 1)
    ) {
      setUserInput(text);
    }
    const n = text.trim().length;
    // clear search results
    if (n === 0) {
      setPromptHints([]);
    } else if (text.match(ChatCommandPrefix)) {
      // setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // check if need to trigger auto completion
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      }
    }
  };

  const [isListening, setIsListening] = useState(false);
  const [isTranscription, setIsTranscription] = useState(false);
  const [speechApi, setSpeechApi] = useState<any>(null);

  const startListening = async () => {
    if (speechApi) {
      showToast(Locale.Settings.STT.StartListening);
      await speechApi.start();
      setIsListening(true);
    }
  };

  const stopListening = async () => {
    if (speechApi) {
      if (config.sttConfig.engine !== DEFAULT_STT_ENGINE)
        setIsTranscription(true);
      showToast(Locale.Settings.STT.StopListening);
      await speechApi.stop();
      setIsListening(false);
    }
  };

  const onRecognitionEnd = (finalTranscript: string) => {
    console.log(finalTranscript);
    if (finalTranscript) setUserInput(finalTranscript);
    if (config.sttConfig.engine !== DEFAULT_STT_ENGINE)
      setIsTranscription(false);
  };

  const doSubmit = (input: string) => {
    const value = inputRef.current?.value ?? input;
    if (value.trim() === "" && isEmpty(attachImages)) return;
    const matchCommand = chatCommands.match(value);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setIsLoading(true);
    chatStore
      .onUserInput(value, attachImages, attachFiles)
      .then(() => setIsLoading(false));
    setAttachImages([]);
    setAttachFiles([]);
    chatStore.setLastInput(value);
    setUserInput("");
    setPromptHints([]);
    if (inputRef.current) inputRef.current.value = "";
    saveChatInputText(inputRef.current?.value ?? "");
    saveChatInputScrollTop(inputRef.current?.scrollTop ?? 0);
    saveChatInputImages([]);
    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          // 排除系统消息和已迁移的系统消息（有contentKey的消息）
          if (
            m.content.length === 0 &&
            m.role !== "system" &&
            !(m as any).contentKey
          ) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // auto sync mask config from global config
      if (session.mask.syncGlobalConfig) {
        console.log("[Mask] syncing from global, name = ", session.mask.name);
        session.mask.modelConfig = { ...config.modelConfig };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (isFirefox()) config.sttConfig.engine = FIREFOX_DEFAULT_STT_ENGINE;
    setSpeechApi(
      config.sttConfig.engine === DEFAULT_STT_ENGINE
        ? new WebTranscriptionApi((transcription) =>
            onRecognitionEnd(transcription),
          )
        : new OpenAITranscriptionApi((transcription) =>
            onRecognitionEnd(transcription),
          ),
    );
  }, [session]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果是长输入模式，Enter 换行，Ctrl+Enter 发送
    if (session.longInputMode) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        doSubmit(userInput);
        e.preventDefault();
      }
      // 仅 Enter 时不发送，交给浏览器默认行为（换行）
      return;
    }
    // 普通模式
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };
  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateTargetSession(
      session,
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    // 保存删除前的 messages 状态
    const prevMessages = session.messages.slice();

    deleteMessage(msgId);

    // 显示 Toast，提供撤销按钮
    showToast(
      Locale.Home.DeleteToast, // 你可以在 Locale 里加一个类似 "消息已删除"
      {
        text: Locale.Home.Revert, // 你可以在 Locale 里加一个 "撤销"
        onClick() {
          chatStore.updateTargetSession(
            session,
            (session) => (session.messages = prevMessages),
          );
        },
      },
      5000,
    );
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    let requestIndex = resendingIndex;

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          requestIndex = i;
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // // delete the original messages
    // deleteMessage(userMessage.id);
    // deleteMessage(botMessage?.id);

    // resend the message
    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore
      .onUserInput(
        textContent,
        images,
        userMessage.fileInfos,
        userMessage.webSearchReferences,
        requestIndex,
      )
      .then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) =>
      session.mask.context.push(message),
    );

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  const [speechStatus, setSpeechStatus] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  async function openaiSpeech(text: string) {
    if (speechStatus) {
      ttsPlayer.stop();
      setSpeechStatus(false);
    } else {
      var api: ClientApi;
      api = new ClientApi(ModelProvider.GPT);
      const config = useAppConfig.getState();
      setSpeechLoading(true);
      ttsPlayer.init();
      let audioBuffer: ArrayBuffer;
      const { markdownToTxt } = require("markdown-to-txt");
      const textContent = markdownToTxt(text);
      if (config.ttsConfig.engine !== DEFAULT_TTS_ENGINE) {
        const edgeVoiceName = accessStore.edgeVoiceName();
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          edgeVoiceName,
          OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
        );
        audioBuffer = await tts.toArrayBuffer(textContent);
      } else {
        audioBuffer = await api.llm.speech({
          model: config.ttsConfig.model,
          input: textContent,
          voice: config.ttsConfig.voice,
          speed: config.ttsConfig.speed,
        });
      }
      setSpeechStatus(true);
      ttsPlayer
        .play(audioBuffer, () => {
          setSpeechStatus(false);
        })
        .catch((e) => {
          console.error("[OpenAI Speech]", e);
          showToast(prettyObject(e));
          setSpeechStatus(false);
        })
        .finally(() => setSpeechLoading(false));
    }
  }

  // 优化点1：渲染相关 useMemo/useState/useEffect 彻底排除 system message
  // context 只保留 mask.context，不包含 system message
  const context: RenderMessage[] = useMemo(() => {
    return session.mask.hideContext ? [] : session.mask.context.slice();
  }, [session.mask.context, session.mask.hideContext]);

  // 优化点2：渲染消息时彻底过滤 system message
  // 只在渲染时过滤，不影响原始 session.messages
  const filteredSessionMessages = useMemo(() => {
    return (session.messages as RenderMessage[]).filter(
      (m) => m.role !== "system",
    );
  }, [session.messages]);

  // preview messages
  const renderMessages = useMemo(() => {
    return context.concat(filteredSessionMessages).concat(
      (userInput.length > 0 && config.sendPreviewBubble
        ? [
            {
              ...createMessage({
                role: "user",
                content: userInput,
              }),
              preview: true,
            },
          ]
        : []) as RenderMessage[],
    );
  }, [
    config.sendPreviewBubble,
    context,
    isLoading,
    filteredSessionMessages,
    userInput,
  ]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  // 监听 renderMessages 长度变化，确保 msgRenderIndex 始终正确
  useEffect(() => {
    const newIndex = Math.max(0, renderMessages.length - CHAT_PAGE_SIZE);
    if (newIndex !== msgRenderIndex) {
      _setMsgRenderIndex(newIndex);
    }
  }, [renderMessages.length, msgRenderIndex]);

  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };
  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (text) => {
      if (accessStore.disableFastLink) return;
      console.log("[Command] got code from url: ", text);
      showConfirm(Locale.URLCommand.Code + `code = ${text}`).then((res) => {
        if (res) {
          accessStore.update((access) => (access.accessCode = text));
        }
      });
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
          code?: string;
        };

        console.log("[Command] got settings from url: ", payload);

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update((access) => (access.openaiUrl = payload.url!));
            }
            accessStore.update((access) => (access.useCustomConfig = true));
          });
        }

        if (payload.code) {
          accessStore.update((access) => (access.accessCode = payload.code!));
          if (accessStore.isAuthorized()) {
            context.pop();
          }
        }
      } catch {
        console.error("[Command] failed to get settings from url: ", text);
      }
    },
  });

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = chatStore.currentSession().mask.modelConfig.model;
      if (!isVisionModel(currentModel)) {
        return;
      }
      const items = (event.clipboardData || window.clipboardData).items;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const images: string[] = [];
            images.push(...attachImages);
            images.push(
              ...(await new Promise<string[]>((res, rej) => {
                setUploading(true);
                const imagesData: string[] = [];
                uploadImageRemote(file)
                  .then((dataUrl) => {
                    imagesData.push(dataUrl);
                    setUploading(false);
                    res(imagesData);
                  })
                  .catch((e) => {
                    setUploading(false);
                    rej(e);
                  });
              })),
            );

            setAttachImages(images);
            saveChatInputImages(images); // 新增：保存图片
          }
        }
      }
      // 粘贴文本后，确保高度及时变化
      setTimeout(() => {
        if (event.currentTarget) {
          setUserInput(event.currentTarget.value);
          saveChatInputText(event.currentTarget.value);
          console.log(
            "[UserInput][Save][Paste] 粘贴后保存未完成输入:",
            event.currentTarget.value,
          );
        }
      }, 0);
    },
    [attachImages, chatStore],
  );

  async function capturePhoto() {
    const images: string[] = [];
    images.push(...attachImages);

    // 使用原生相机拍照
    const newImages = await new Promise<string[]>((resolve, reject) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.capture = "environment"; // 调用后置摄像头
      fileInput.multiple = false;

      fileInput.onchange = async (event: any) => {
        const file = event.target.files?.[0];
        if (!file) {
          resolve([]);
          return;
        }

        try {
          setUploading(true);
          const dataUrl = await uploadImageRemote(file);
          setUploading(false);
          resolve([dataUrl]);
        } catch (error) {
          setUploading(false);
          console.error("上传拍照图片失败:", error);
          showToast("图片上传失败，请重试");
          reject(error);
        }
      };

      // 如果用户取消拍照，也需要处理
      fileInput.oncancel = () => {
        resolve([]);
      };

      fileInput.click();
    });

    if (newImages.length > 0) {
      images.push(...newImages);
      setAttachImages(images);
      saveChatInputImages(images);
    }
  }

  async function uploadImage() {
    const images: string[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<string[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif, image/gif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            uploadImageRemote(file)
              .then((dataUrl) => {
                imagesData.push(dataUrl);
                if (imagesData.length === files.length) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    setAttachImages(images);
    saveChatInputImages(images); // 新增：保存图片
  }

  async function uploadFile() {
    const uploadFiles: FileInfo[] = [];
    uploadFiles.push(...attachFiles);

    uploadFiles.push(
      ...(await new Promise<FileInfo[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".pdf,.txt,.md,.json,.csv,.docx,.srt,.mp3";
        fileInput.multiple = false;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const file = event.target.files[0];
          const api = new ClientApi();
          const fileDatas: FileInfo[] = [];
          api.file
            .uploadForRag(file, session)
            .then((fileInfo) => {
              console.log(fileInfo);
              fileDatas.push(fileInfo);
              session.attachFiles.push(fileInfo);
              setUploading(false);
              res(fileDatas);
            })
            .catch((e) => {
              setUploading(false);
              rej(e);
            });
        };
        fileInput.click();
      })),
    );

    const filesLength = uploadFiles.length;
    if (filesLength > 5) {
      uploadFiles.splice(5, filesLength - 5);
    }
    setAttachFiles(uploadFiles);
  }

  // 快捷键 shortcut keys
  const [showShortcutKeyModal, setShowShortcutKeyModal] = useState(false);

  const [showChatSidePanel, setShowChatSidePanel] = useState(false);

  const handleTripleClick = useTripleClick(messageEditRef);

  // 修改编辑消息处理函数
  const handleEditMessage = async (
    message: ChatMessage,
    type: "content" | "reasoningContent" = "content",
    select: { anchorText: string; extendText: string } = {
      anchorText: "",
      extendText: "",
    },
  ) => {
    if (message.streaming) return;

    const content =
      type === "content"
        ? getMessageTextContent(message)
        : getMessageTextReasoningContent(message);

    console.log("[handleEditMessage] select:", select);

    // 如果有选中的文本，尝试定位到该位置
    if (select.anchorText || select.extendText) {
      setTimeout(() => {
        if (messageEditRef.current) {
          const textarea = messageEditRef.current;
          let searchText = select.anchorText || select.extendText;
          if (!searchText) {
            return;
          }

          // 搜索文本在 content 中的位置
          const searchIndex = content.indexOf(searchText);
          if (searchIndex === -1) {
            return;
          }

          // 计算目标文本所在的行号
          const contentBeforeSearch = content.substring(0, searchIndex);
          const lineNumber = contentBeforeSearch.split("\n").length;

          // 获取 textarea 的样式
          const style = window.getComputedStyle(textarea);
          const lineHeight = parseInt(style.lineHeight);

          // 计算精确的滚动位置
          const position = (lineNumber - 1) * 21;

          console.log(
            "[handleEditMessage] search text:",
            searchText,
            "line:",
            lineNumber,
            "position:",
            position,
          );

          // 滚动到对应的 position，使用平滑滚动
          textarea.scrollTo({
            top: Math.max(0, position), // 稍微往上一点，让目标行更明显
            behavior: "smooth",
          });
        }
      }, 100);
    }

    const result = await showPrompt(
      Locale.Chat.Actions.Edit,
      content,
      15,
      messageEditRef,
    );

    // 处理编辑后的内容
    let newMessage = result.value;
    let newContent: string | MultimodalContent[] = newMessage;
    const images = getMessageImages(message);
    if (type === "content" && images.length > 0) {
      newContent = [{ type: "text", text: newMessage }];
      for (let i = 0; i < images.length; i++) {
        newContent.push({
          type: "image_url",
          image_url: {
            url: images[i],
          },
        });
      }
    }

    // 更新消息内容
    chatStore.updateTargetSession(session, (session) => {
      const m = session.mask.context
        .concat(session.messages)
        .find((m) => m.id === message.id);
      if (m) {
        if (type === "content") {
          m.content = newContent;
        }
        if (type === "reasoningContent") {
          m.reasoningContent = newContent as string;
        }
      }
    });

    if (result.byCtrlEnter && message.role === "user") {
      onResend(message);
    }
  };

  const [messageHeights, setMessageHeights] = useState<{
    [key: string]: number;
  }>({});
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // 使用 useEffect 和 ResizeObserver 来监听消息高度变化
  useEffect(() => {
    const observers = new Map<string, ResizeObserver>();

    // 清理函数
    const cleanup = () => {
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
    };

    // 为每个消息创建 ResizeObserver
    Object.entries(messageRefs.current).forEach(([messageId, element]) => {
      if (!element) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const height = entry.contentRect.height;
          setMessageHeights((prev) => {
            // 只有当高度真正改变时才更新状态
            if (prev[messageId] === height) return prev;
            return {
              ...prev,
              [messageId]: height,
            };
          });
        }
      });

      observer.observe(element);
      observers.set(messageId, observer);
    });

    return cleanup;
  }, [session.messages.length]); // 只在消息列表长度变化时重新设置观察者

  // ========== system message content 存储工具 ==========
  // @ts-ignore
  interface SystemMetaMessage extends ChatMessage {
    contentKey?: string;
  }
  function getSystemMessageContentKey(sessionId: string) {
    return `system_message_content_${sessionId}`;
  }
  async function saveSystemMessageContentToStorage(
    sessionId: string,
    content: string,
  ) {
    try {
      // 使用 IndexedDB 存储
      const success = await systemMessageStorage.saveSystemMessage(
        sessionId,
        content,
      );
      if (!success) {
        throw new Error("保存到 IndexedDB 失败");
      }
    } catch (error) {
      console.error("保存系统消息失败:", error);
      alert("系统提示词保存失败，请重试。");
    }
  }
  async function loadSystemMessageContentFromStorage(
    sessionId: string,
  ): Promise<string> {
    try {
      const content = await systemMessageStorage.getSystemMessage(sessionId);
      return content || "";
    } catch (error) {
      console.error("读取系统消息失败:", error);
      return "";
    }
  }
  // 自动迁移旧 system message 到新存储
  function migrateSystemMessageIfNeeded(session: any) {
    const sysMsgIdx = session.messages.findIndex(
      (m: any) => m.role === "system",
    );
    if (sysMsgIdx >= 0) {
      const sysMsg = session.messages[sysMsgIdx];
      // 旧格式：content 有内容但没有 contentKey
      if (sysMsg.content && !sysMsg.contentKey) {
        saveSystemMessageContentToStorage(session.id, sysMsg.content);
        // 替换为 meta
        const newSysMsg = {
          ...sysMsg,
          content: "",
          contentKey: getSystemMessageContentKey(session.id),
        };
        session.messages[sysMsgIdx] = newSysMsg;
      }
    }
  }
  // ... existing code ...
  // 编辑系统提示词逻辑，保存到 localStorage，只存 meta
  // ... window-actions 编辑上下文按钮 ...
  return (
    <>
      <div className={styles.chat} key={session.id}>
        <div className="window-header" data-tauri-drag-region>
          {/* {isMobileScreen && (
            <div className="window-actions">
              <div className={"window-action-button"}>
                <IconButton
                  icon={<ReturnIcon />}
                  bordered
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => navigate(Path.Home)}
                />
              </div>
            </div>
          )} */}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
              onClickCapture={() => setIsEditingMessage(true)}
            >
              {!session.topic ? DEFAULT_TOPIC : session.topic}
            </div>
            {!isMobileScreen && (
              <div className="window-header-sub-title">
                {Locale.Chat.SubTitle(session.messages.length)}
              </div>
            )}
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<EditIcon />}
                bordered
                title="编辑上下文"
                onClick={async () => {
                  // 兼容迁移旧 system message
                  migrateSystemMessageIfNeeded(session);
                  // 获取当前 session 的 system 消息
                  let systemMessage = session.messages.find(
                    (m) => m.role === "system",
                  ) as SystemMetaMessage | undefined;
                  let systemContent = systemMessage?.content || "";
                  // 如果只存 meta，则从 storage 取
                  if (
                    systemMessage &&
                    !systemContent &&
                    systemMessage.contentKey
                  ) {
                    systemContent = await loadSystemMessageContentFromStorage(
                      session.id,
                    );
                  }
                  // 复用双击消息编辑的逻辑
                  const result = await showPrompt(
                    "编辑系统提示词",
                    typeof systemContent === "string" ? systemContent : "",
                    15,
                  );
                  // 直接保存编辑内容为 system 消息内容
                  const newContent = result.value.trim();
                  chatStore.updateTargetSession(session, (session) => {
                    // 移除现有的 system 消息
                    session.messages = session.messages.filter(
                      (m) => m.role !== "system",
                    );
                    // 如果新内容不为空，保存到 storage，并添加 meta
                    if (newContent) {
                      saveSystemMessageContentToStorage(session.id, newContent);
                      const newSystemMessage = createMessage({
                        role: "system",
                        content: "", // 不存内容
                      }) as SystemMetaMessage;
                      // @ts-ignore
                      newSystemMessage.contentKey = getSystemMessageContentKey(
                        session.id,
                      );
                      session.messages.unshift(newSystemMessage);
                    }
                  });
                }}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<ExportIcon />}
                bordered
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  setShowExport(true);
                }}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<DeleteIcon />}
                bordered
                title={Locale.Chat.Actions.Delete}
                onClick={async () => {
                  chatStore.deleteSession(chatStore.currentSessionIndex);
                }}
              />
            </div>
            {/* {showMaxIcon && (
              <div className="window-action-button">
                <IconButton
                  icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                  bordered
                  title={Locale.Chat.Actions.FullScreen}
                  aria={Locale.Chat.Actions.FullScreen}
                  onClick={() => {
                    config.update(
                      (config) => (config.tightBorder = !config.tightBorder),
                    );
                  }}
                />
              </div>
            )} */}
          </div>

          <PromptToast
            showToast={!hitBottom}
            showModal={showPromptModal}
            setShowModal={setShowPromptModal}
          />
        </div>
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <div
              className={styles["chat-body"]}
              ref={scrollRef}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
                setAutoScroll(false);
              }}
            >
              {messages.map((message, i) => {
                const isUser = message.role === "user";
                const isSystem = message.role === "system";
                const isContext = i < context.length;
                const showActions =
                  !(message.preview || message.content.length === 0) &&
                  !isContext;
                const showTyping = message.preview || message.streaming;

                const shouldShowClearContextDivider =
                  i === clearContextIndex - 1;

                // 系统级提示词在会话界面中隐藏
                if (isSystem) {
                  return null;
                }

                return (
                  <Fragment key={message.id}>
                    <div
                      className={
                        isUser
                          ? styles["chat-message-user"]
                          : styles["chat-message"]
                      }
                    >
                      <div
                        className={
                          styles["chat-message-container"] +
                          " " +
                          (isUser
                            ? styles["chat-message-container-user"]
                            : styles["chat-message-container-assistant"])
                        }
                      >
                        <div className={styles["chat-message-header"]}>
                          {!isUser && (
                            <div className={styles["chat-model-name"]}>
                              {message.model}
                            </div>
                          )}

                          {showActions && (
                            <div className={styles["chat-message-actions"]}>
                              <MessageActions
                                message={message}
                                onResend={onResend}
                                onDelete={onDelete}
                                onUserStop={onUserStop}
                                index={i}
                              />
                            </div>
                          )}
                        </div>
                        {!isUser &&
                          message.toolMessages &&
                          message.toolMessages.map((tool, index) => (
                            <div
                              className={styles["chat-message-tools-status"]}
                              key={index}
                            >
                              <div
                                className={styles["chat-message-tools-name"]}
                              >
                                <CheckmarkIcon
                                  className={styles["chat-message-checkmark"]}
                                />
                                {tool.toolName}:
                                <code
                                  className={
                                    styles["chat-message-tools-details"]
                                  }
                                >
                                  {tool.toolInput}
                                </code>
                              </div>
                            </div>
                          ))}
                        {message?.tools?.length == 0 && showTyping && (
                          <div className={styles["chat-message-status"]}>
                            {Locale.Chat.Typing}
                          </div>
                        )}
                        {/*@ts-ignore*/}
                        {message?.tools?.length > 0 && (
                          <div className={styles["chat-message-tools"]}>
                            {message?.tools?.map((tool) => (
                              <div
                                key={tool.id}
                                title={tool?.errorMsg}
                                className={styles["chat-message-tool"]}
                              >
                                {tool.isError === false ? (
                                  <ConfirmIcon />
                                ) : tool.isError === true ? (
                                  <CloseIcon />
                                ) : (
                                  <LoadingButtonIcon />
                                )}
                                <span>{tool?.function?.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!isUser && message.reasoningContent && (
                          <ThinkingContent
                            message={message}
                            onDoubleClick={(e) =>
                              handleTripleClick(e, (select) => {
                                handleEditMessage(
                                  message,
                                  "reasoningContent",
                                  select,
                                );
                              })
                            }
                          />
                        )}
                        <div
                          className={styles["chat-message-item"]}
                          ref={(el) => {
                            if (message.id) {
                              messageRefs.current[message.id] = el;
                            }
                          }}
                          onDoubleClick={async (e) => {
                            if (message.streaming) return;
                            // 用户消息保持双击编辑
                            if (isUser) {
                              handleEditMessage(message, "content");
                            }
                          }}
                          onClick={(e) => {
                            // 非用户消息使用三击编辑
                            if (!isUser) {
                              handleTripleClick(e, (select) => {
                                handleEditMessage(message, "content", select);
                              });
                            }
                          }}
                        >
                          {Array.isArray(message.content) ? (
                            message.content.map((content, index) => (
                              <Fragment key={index}>
                                {content.type === "text" && (
                                  <Markdown
                                    key={
                                      message.streaming
                                        ? "loading"
                                        : `text-${index}`
                                    }
                                    content={content.text || ""}
                                    webSearchReferences={
                                      message.webSearchReferences
                                    }
                                    loading={
                                      (message.preview || message.streaming) &&
                                      !content.text &&
                                      !isUser &&
                                      (
                                        message.content as MultimodalContent[]
                                      ).every((c) => c.type === "text")
                                    }
                                    onDoubleClickCapture={() => {
                                      if (!isMobileScreen) return;
                                      setUserInput(content.text || "");
                                    }}
                                    fontSize={fontSize}
                                    fontFamily={fontFamily}
                                    parentRef={scrollRef}
                                    defaultShow={i >= messages.length - 6}
                                  />
                                )}
                                {content.type === "image_url" &&
                                  content.image_url?.url && (
                                    <img
                                      className={
                                        styles["chat-message-item-image"]
                                      }
                                      src={content.image_url.url}
                                      alt=""
                                    />
                                  )}
                              </Fragment>
                            ))
                          ) : (
                            <>
                              <Markdown
                                key={message.streaming ? "loading" : "done"}
                                content={getMessageTextContent(message)}
                                webSearchReferences={
                                  message.webSearchReferences
                                }
                                loading={
                                  (message.preview || message.streaming) &&
                                  message.content.length === 0 &&
                                  !isUser
                                }
                                onDoubleClickCapture={() => {
                                  if (!isMobileScreen) return;
                                  setUserInput(getMessageTextContent(message));
                                }}
                                fontSize={fontSize}
                                fontFamily={fontFamily}
                                parentRef={scrollRef}
                                defaultShow={i >= messages.length - 6}
                              />
                              {getMessageImages(message).length == 1 && (
                                <img
                                  className={styles["chat-message-item-image"]}
                                  src={getMessageImages(message)[0]}
                                  alt=""
                                />
                              )}
                              {getMessageImages(message).length > 1 && (
                                <div
                                  className={styles["chat-message-item-images"]}
                                  style={
                                    {
                                      "--image-count":
                                        getMessageImages(message).length,
                                    } as React.CSSProperties
                                  }
                                >
                                  {getMessageImages(message).map(
                                    (image, index) => (
                                      <img
                                        className={
                                          styles[
                                            "chat-message-item-image-multi"
                                          ]
                                        }
                                        key={index}
                                        src={image}
                                        alt=""
                                      />
                                    ),
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* 将底部操作按钮组移到这里，只在非用户消息时显示 */}
                        {!isUser &&
                          messageHeights[message.id ?? ""] >
                            window.innerHeight * 0.1 && (
                            <div
                              className={styles["chat-message-bottom-actions"]}
                            >
                              <MessageActions
                                message={message}
                                onResend={onResend}
                                onDelete={onDelete}
                                onUserStop={onUserStop}
                                index={i}
                              />
                            </div>
                          )}

                        {message?.audioUrl && (
                          <div className={styles["chat-message-audio"]}>
                            <audio src={message.audioUrl} controls />
                          </div>
                        )}

                        <div className={styles["chat-message-action-date"]}>
                          {isContext
                            ? Locale.Chat.IsContext
                            : message.date.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {shouldShowClearContextDivider && <ClearContextDivider />}
                  </Fragment>
                );
              })}
            </div>
            <div className={styles["chat-input-panel"]}>
              <PromptHints
                prompts={promptHints}
                onPromptSelect={onPromptSelect}
              />

              <ChatActions
                uploadImage={uploadImage}
                capturePhoto={capturePhoto}
                setAttachImages={setAttachImages}
                uploadFile={uploadFile}
                setAttachFiles={setAttachFiles}
                setUploading={setUploading}
                showPromptModal={() => setShowPromptModal(true)}
                scrollToBottom={scrollToBottom}
                hitBottom={hitBottom}
                uploading={uploading}
                showPromptHints={() => {
                  // Click again to close
                  if (promptHints.length > 0) {
                    setPromptHints([]);
                    return;
                  }

                  inputRef.current?.focus();
                  setUserInput("/");
                  onSearch("");
                }}
                setShowShortcutKeyModal={setShowShortcutKeyModal}
                setUserInput={setUserInput}
                setShowChatSidePanel={setShowChatSidePanel}
              />
              <label
                className={clsx(styles["chat-input-panel-inner"], {
                  [styles["chat-input-panel-inner-attach"]]:
                    attachImages.length !== 0 || attachFiles.length != 0,
                })}
                htmlFor="chat-input"
              >
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  defaultValue={userInput}
                  // placeholder="Enter 或 Ctrl + Enter 发送，Shift + Enter 换行，/ 搜索提示词，: 使用命令"
                  onInput={(e) => onInput(e.currentTarget.value, e)}
                  onKeyDown={onInputKeyDown}
                  onPaste={handlePaste}
                  rows={inputRows}
                  autoFocus={autoFocus}
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily,
                  }}
                  onBlur={() => {
                    setUserInput(inputRef.current?.value ?? "");
                    saveChatInputText.flush && saveChatInputText.flush();
                  }}
                  onScroll={(e) =>
                    saveChatInputScrollTop(e.currentTarget.scrollTop)
                  }
                />
                {attachImages.length != 0 && (
                  <div className={styles["attach-images"]}>
                    {attachImages.map((image, index) => {
                      return (
                        <div
                          key={index}
                          className={styles["attach-image"]}
                          style={{ backgroundImage: `url("${image}")` }}
                        >
                          <div className={styles["attach-image-mask"]}>
                            <DeleteImageButton
                              deleteImage={() => {
                                setAttachImages(
                                  attachImages.filter((_, i) => i !== index),
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {attachFiles.length != 0 && (
                  <div className={styles["attach-files"]}>
                    {attachFiles.map((file, index) => {
                      return (
                        <div
                          key={index}
                          className={styles["attach-file"]}
                          title={file.originalFilename}
                        >
                          <div className={styles["attach-file-info"]}>
                            {file.originalFilename}
                          </div>
                          <div className={styles["attach-file-mask"]}>
                            <DeleteFileButton
                              deleteFile={() => {
                                setAttachFiles(
                                  attachFiles.filter((_, i) => i !== index),
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {config.sttConfig.enable && (
                  <IconButton
                    icon={isListening ? <VoiceCloseIcon /> : <VoiceOpenIcon />}
                    className={styles["chat-input-stt"]}
                    type="secondary"
                    onClick={async () =>
                      isListening
                        ? await stopListening()
                        : await startListening()
                    }
                    loding={isTranscription}
                  />
                )}
                <IconButton
                  icon={<SendWhiteIcon />}
                  className={styles["chat-input-send"]}
                  type="primary"
                  onClick={() => doSubmit(userInput)}
                />
              </label>
            </div>
          </div>
          {/* <div
            className={clsx(styles["chat-side-panel"], {
              [styles["mobile"]]: isMobileScreen,
              [styles["chat-side-panel-show"]]: showChatSidePanel,
            })}
          >
            {showChatSidePanel && (
              <RealtimeChat
                onClose={() => {
                  setShowChatSidePanel(false);
                }}
                onStartVoice={async () => {
                  console.log("start voice");
                }}
              />
            )}
          </div> */}
        </div>
      </div>
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showShortcutKeyModal && (
        <ShortcutKeyModal onClose={() => setShowShortcutKeyModal(false)} />
      )}
    </>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const sessionIndex = chatStore.currentSessionIndex;
  return <_Chat key={sessionIndex}></_Chat>;
}
