/* eslint-disable @next/next/no-img-element */
import { ChatMessage, useAppConfig, useChatStore } from "../store";
import Locale from "../locales";
import styles from "./exporter.module.scss";
import {
  List,
  ListItem,
  Modal,
  Select,
  showImageModal,
  showModal,
  showToast,
} from "./ui-lib";
import { IconButton } from "./button";
import {
  copyToClipboard,
  downloadAs,
  getMessageImages,
  useMobileScreen,
} from "../utils";
import { jchatStorage } from "../utils/store";

import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import ChatGptIcon from "../icons/chatgpt.png";
import ShareIcon from "../icons/share.svg";
import BotIcon from "../icons/bot.png";

import DownloadIcon from "../icons/download.svg";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSelector, useMessageSelector } from "./message-selector";

import dynamic from "next/dynamic";
import NextImage from "next/image";

import { toBlob, toPng } from "html-to-image";

import { prettyObject } from "../utils/format";
import { EXPORT_MESSAGE_CLASS_NAME } from "../constant";
import { getClientConfig } from "../config/client";
import { type ClientApi, getClientApi } from "../client/api";
import { getMessageTextContent } from "../utils";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

const EXPORT_FORMAT_KEY = "export-format"; // 记住导出格式的 jchatStorage key

export function ExportMessageModal(props: { onClose: () => void }) {
  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Export.Title}
        defaultMax={true}
        onClose={props.onClose}
      >
        <div style={{ minHeight: "40vh" }}>
          <MessageExporter />
        </div>
      </Modal>
    </div>
  );
}

function useSteps(
  steps: Array<{
    name: string;
    value: string;
  }>,
) {
  const stepCount = steps.length;
  const [currentStepIndex, setCurrentStepIndex] = useState(1);
  const nextStep = () =>
    setCurrentStepIndex((currentStepIndex + 1) % stepCount);
  const prevStep = () =>
    setCurrentStepIndex((currentStepIndex - 1 + stepCount) % stepCount);

  return {
    currentStepIndex,
    setCurrentStepIndex,
    nextStep,
    prevStep,
    currentStep: steps[currentStepIndex],
  };
}

function Steps<
  T extends {
    name: string;
    value: string;
  }[],
>(props: { steps: T; onStepChange?: (index: number) => void; index: number }) {
  const steps = props.steps;
  const stepCount = steps.length;

  return (
    <div className={styles["steps"]}>
      <div className={styles["steps-progress"]}>
        <div
          className={styles["steps-progress-inner"]}
          style={{
            width: `${((props.index + 1) / stepCount) * 100}%`,
          }}
        ></div>
      </div>
      <div className={styles["steps-inner"]}>
        {steps.map((step, i) => {
          return (
            <div
              key={i}
              className={`${styles["step"]} ${
                styles[i <= props.index ? "step-finished" : ""]
              } ${i === props.index && styles["step-current"]} clickable`}
              onClick={() => {
                props.onStepChange?.(i);
              }}
              role="button"
            >
              <span className={styles["step-index"]}>{i + 1}</span>
              <span className={styles["step-name"]}>{step.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MessageExporter() {
  const steps = [
    {
      name: Locale.Export.Steps.Select,
      value: "select",
    },
    {
      name: Locale.Export.Steps.Preview,
      value: "preview",
    },
  ];
  const { currentStep, setCurrentStepIndex, currentStepIndex } =
    useSteps(steps);
  const formats = ["text", "image", "json"] as const;
  type ExportFormat = (typeof formats)[number];

  // 初始化导出配置，默认为 image 格式
  const [exportConfig, setExportConfig] = useState({
    format: "image" as ExportFormat,
    includeContext: true,
  });

  // 新增：追踪用户是否手动调整过选择
  const [userSelectionTouched, setUserSelectionTouched] = useState(false);

  // 异步加载保存的导出格式
  useEffect(() => {
    const loadSavedFormat = async () => {
      try {
        const savedFormat = (await jchatStorage.getItem(
          EXPORT_FORMAT_KEY,
        )) as ExportFormat | null;
        if (
          savedFormat &&
          (formats as readonly string[]).includes(savedFormat)
        ) {
          setExportConfig((prev) => ({
            ...prev,
            format: savedFormat,
          }));
        }
      } catch (error) {
        console.error("加载保存的导出格式失败:", error);
      }
    };
    loadSavedFormat();
  }, []);

  // 更新导出配置，并在切换格式时写入 jchatStorage
  const updateExportConfig = async (
    updater: (config: typeof exportConfig) => void,
  ) => {
    const config = { ...exportConfig };
    updater(config);
    setExportConfig(config);
    // 如果格式有变化则写入 jchatStorage
    if (config.format !== exportConfig.format) {
      try {
        await jchatStorage.setItem(EXPORT_FORMAT_KEY, config.format);
      } catch (error) {
        console.error("保存导出格式失败:", error);
      }
    }
  };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const { selection, updateSelection } = useMessageSelector();

  // 自动选择函数
  function autoSelectByFormat(format: ExportFormat) {
    updateSelection((selection) => {
      selection.clear();
      if (format === "image") {
        session.messages.forEach((m) => {
          if (m.role !== "system") selection.add(m.id);
        });
      } else {
        // text/json
        session.mask.context.forEach((m) => selection.add(m.id));
        session.messages.forEach((m) => selection.add(m.id));
      }
    });
  }

  // 初始化时根据格式自动选择
  useEffect(() => {
    autoSelectByFormat(exportConfig.format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportConfig.format]);

  // 只要用户手动调整选择，就设置 userSelectionTouched
  function onUserSelectChange(updater: (selection: Set<string>) => void) {
    setUserSelectionTouched(true);
    updateSelection(updater);
  }

  const selectedMessages = useMemo(() => {
    const ret: ChatMessage[] = [];
    if (exportConfig.includeContext) {
      ret.push(...session.mask.context);
    }

    ret.push(...session.messages.filter((m) => selection.has(m.id)));
    return ret;
  }, [
    exportConfig.includeContext,
    session.messages,
    session.mask.context,
    selection,
  ]);
  function preview() {
    if (exportConfig.format === "text") {
      return (
        <MarkdownPreviewer messages={selectedMessages} topic={session.topic} />
      );
    } else if (exportConfig.format === "json") {
      return (
        <JsonPreviewer messages={selectedMessages} topic={session.topic} />
      );
    } else {
      return (
        <ImagePreviewer messages={selectedMessages} topic={session.topic} />
      );
    }
  }
  return (
    <>
      <Steps
        steps={steps}
        index={currentStepIndex}
        onStepChange={setCurrentStepIndex}
      />
      <div
        className={styles["message-exporter-body"]}
        style={currentStep.value !== "select" ? { display: "none" } : {}}
      >
        <MessageSelector
          selection={selection}
          updateSelection={onUserSelectChange}
          defaultSelectAll={false}
        />
      </div>
      {currentStep.value === "preview" && (
        <>
          <div className={styles["message-exporter-body"]}>
            <List>
              <ListItem
                title={Locale.Export.Format.Title}
                subTitle={Locale.Export.Format.SubTitle}
              >
                <Select
                  value={exportConfig.format}
                  onChange={async (e) => {
                    const newFormat = e.currentTarget.value as ExportFormat;
                    await updateExportConfig(
                      (config) => (config.format = newFormat),
                    );
                    if (!userSelectionTouched) {
                      autoSelectByFormat(newFormat);
                    }
                  }}
                >
                  {formats.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </ListItem>
            </List>
            <div className={styles["message-exporter-body"]}>{preview()}</div>
          </div>
        </>
      )}
    </>
  );
}

export function RenderExport(props: {
  messages: ChatMessage[];
  onRender: (messages: ChatMessage[]) => void;
}) {
  const domRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const dom = domRef.current;
    const messages = Array.from(
      dom.getElementsByClassName(EXPORT_MESSAGE_CLASS_NAME),
    );

    if (messages.length !== props.messages.length) {
      return;
    }

    const renderMsgs = messages.map((v, i) => {
      const [role, _] = v.id.split(":");
      return {
        id: i.toString(),
        role: role as any,
        content: role === "user" ? (v.textContent ?? "") : v.innerHTML,
        date: "",
      };
    });

    props.onRender(renderMsgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={domRef}>
      {props.messages.map((m, i) => (
        <div
          key={i}
          id={`${m.role}:${i}`}
          className={EXPORT_MESSAGE_CLASS_NAME}
        >
          <Markdown content={getMessageTextContent(m)} defaultShow />
        </div>
      ))}
    </div>
  );
}

export function PreviewActions(props: {
  download: () => void;
  copy: () => void;
  showCopy?: boolean;
  messages?: ChatMessage[];
}) {
  const [loading, setLoading] = useState(false);
  const [shouldExport, setShouldExport] = useState(false);
  const config = useAppConfig();
  const onRenderMsgs = (msgs: ChatMessage[]) => {
    setShouldExport(false);

    const api: ClientApi = getClientApi(config.modelConfig.providerName);

    api
      .share(msgs)
      .then((res) => {
        if (!res) return;
        showModal({
          title: Locale.Export.Share,
          children: [
            <input
              type="text"
              value={res}
              key="input"
              style={{
                width: "100%",
                maxWidth: "unset",
              }}
              readOnly
              onClick={(e) => e.currentTarget.select()}
            ></input>,
          ],
          actions: [
            <IconButton
              icon={<CopyIcon />}
              text={Locale.Chat.Actions.Copy}
              key="copy"
              onClick={() => copyToClipboard(res)}
            />,
          ],
        });
        setTimeout(() => {
          window.open(res, "_blank");
        }, 800);
      })
      .catch((e) => {
        console.error("[Share]", e);
        showToast(prettyObject(e));
      })
      .finally(() => setLoading(false));
  };

  const share = async () => {
    if (props.messages?.length) {
      setLoading(true);
      setShouldExport(true);
    }
  };

  return (
    <>
      <div className={styles["preview-actions"]}>
        {props.showCopy && (
          <IconButton
            text={Locale.Export.Copy}
            bordered
            shadow
            icon={<CopyIcon />}
            onClick={props.copy}
          ></IconButton>
        )}
        <IconButton
          text={Locale.Export.Download}
          bordered
          shadow
          icon={<DownloadIcon />}
          onClick={props.download}
        ></IconButton>
        {/* <IconButton
          text={Locale.Export.Share}
          bordered
          shadow
          icon={loading ? <LoadingIcon /> : <ShareIcon />}
          onClick={share}
        ></IconButton> */}
      </div>
      <div
        style={{
          position: "fixed",
          right: "200vw",
          pointerEvents: "none",
        }}
      >
        {shouldExport && (
          <RenderExport
            messages={props.messages ?? []}
            onRender={onRenderMsgs}
          />
        )}
      </div>
    </>
  );
}

export function ImagePreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const mask = session.mask;
  const config = useAppConfig();

  const previewRef = useRef<HTMLDivElement>(null);

  const copy = () => {
    showToast(Locale.Export.Image.Toast);
    const dom = previewRef.current;
    if (!dom) return;
    toBlob(dom).then((blob) => {
      if (!blob) return;
      try {
        navigator.clipboard
          .write([
            new ClipboardItem({
              "image/png": blob,
            }),
          ])
          .then(() => {
            showToast(Locale.Copy.Success);
            refreshPreview();
          });
      } catch (e) {
        console.error("[Copy Image] ", e);
        showToast(Locale.Copy.Failed);
      }
    });
  };

  const isMobile = useMobileScreen();

  const download = async () => {
    showToast(Locale.Export.Image.Toast);
    const dom = previewRef.current;
    if (!dom) return;

    const isApp = getClientConfig()?.isApp;

    try {
      const blob = await toPng(dom, {
        includeQueryParams: true,
      });
      if (!blob) return;

      if (isMobile || (isApp && window.__TAURI__)) {
        if (isApp && window.__TAURI__) {
          const result = await window.__TAURI__.dialog.save({
            defaultPath: `${props.topic}.png`,
            filters: [
              {
                name: "PNG Files",
                extensions: ["png"],
              },
              {
                name: "All Files",
                extensions: ["*"],
              },
            ],
          });

          if (result !== null) {
            const response = await fetch(blob);
            const buffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(buffer);
            await window.__TAURI__.fs.writeBinaryFile(result, uint8Array);
            showToast(Locale.Download.Success);
          } else {
            showToast(Locale.Download.Failed);
          }
        } else {
          showImageModal(blob);
        }
      } else {
        const link = document.createElement("a");
        link.download = `${props.topic}.png`;
        link.href = blob;
        link.click();
        refreshPreview();
      }
    } catch (error) {
      showToast(Locale.Download.Failed);
    }
  };

  const refreshPreview = () => {
    const dom = previewRef.current;
    if (dom) {
      dom.innerHTML = dom.innerHTML; // Refresh the content of the preview by resetting its HTML for fix a bug glitching
    }
  };

  return (
    <div className={styles["image-previewer"]}>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={false}
        messages={props.messages}
      />
      <div
        className={`${styles["preview-body"]} ${styles["default-theme"]}`}
        ref={previewRef}
        onClick={copy}
      >
        <div className={styles["chat-info"]}>
          {/* <div className={styles["logo"] + " no-dark"}>
            <NextImage
              src={ChatGptIcon.src}
              alt="logo"
              width={50}
              height={50}
            />
          </div> */}

          {/* <div>
                          <div className={styles["main-title"]}>JChat</div>
            <div className={styles["sub-title"]}>
              github.com/ChatGPTNextWeb/ChatGPT-Next-Web
            </div>
          </div> */}
          <div>
            <div className={styles["chat-info-item"]}>
              {Locale.Exporter.Model}：{mask.modelConfig.model}
            </div>
            {/* <div className={styles["chat-info-item"]}>
              {Locale.Exporter.Messages}：{props.messages.length}
            </div> */}
            {/* <div className={styles["chat-info-item"]}>
              {Locale.Exporter.Topic}：{session.topic}
            </div> */}
            <div className={styles["chat-info-item"]}>
              {Locale.Exporter.Time}：
              {new Date(
                props.messages.at(-1)?.date ?? Date.now(),
              ).toLocaleString()}
            </div>
          </div>
        </div>
        {props.messages.map((m, i) => {
          return (
            <div
              className={styles["message"] + " " + styles["message-" + m.role]}
              key={i}
            >
              {/* <div className={styles["avatar"]}>
              </div> */}

              <div className={styles["body"]}>
                <Markdown
                  content={getMessageTextContent(m)}
                  fontSize={config.fontSize}
                  fontFamily={config.fontFamily}
                  defaultShow
                />
                {getMessageImages(m).length == 1 && (
                  <img
                    key={i}
                    src={getMessageImages(m)[0]}
                    alt="message"
                    className={styles["message-image"]}
                  />
                )}
                {getMessageImages(m).length > 1 && (
                  <div
                    className={styles["message-images"]}
                    style={
                      {
                        "--image-count": getMessageImages(m).length,
                      } as React.CSSProperties
                    }
                  >
                    {getMessageImages(m).map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt="message"
                        className={styles["message-image-multi"]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MarkdownPreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  const mdText =
    `# ${props.topic}\n\n` +
    `> 以下是用户与模型的对话记录\n\n` +
    props.messages
      .map((m) => {
        if (m.role === "user") {
          return `## ${Locale.Export.MessageFromYou}\n\n${getMessageTextContent(m)}`;
        } else if (m.role === "system") {
          return `## ${Locale.Export.MessageFromSystem}\n\n${getMessageTextContent(m).trim()}`;
        } else {
          return `## ${Locale.Export.MessageFromChatGPT}\n\n${getMessageTextContent(m).trim()}`;
        }
      })
      .join("\n\n");

  const copy = () => {
    copyToClipboard(mdText);
  };
  const download = () => {
    downloadAs(mdText, `${props.topic}.md`);
  };
  return (
    <>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={false}
        messages={props.messages}
      />
      <div className="markdown-body" onClick={copy}>
        {/* <Markdown content={mdText} /> */}
        <pre className={styles["export-content"]}>{mdText}</pre>
      </div>
    </>
  );
}

export function JsonPreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  // 移除系统消息的特殊处理，直接导出所有消息
  const msgs = {
    messages: [
      // 不再添加默认的系统消息
      ...props.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
  };
  const mdText = "```json\n" + JSON.stringify(msgs, null, 2) + "\n```";
  const minifiedJson = JSON.stringify(msgs);

  const copy = () => {
    copyToClipboard(minifiedJson);
  };
  const download = () => {
    downloadAs(JSON.stringify(msgs), `${props.topic}.json`);
  };

  return (
    <>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={false}
        messages={props.messages}
      />
      <div className="markdown-body" onClick={copy}>
        <Markdown content={mdText} />
      </div>
    </>
  );
}
