import { useState, useEffect, useMemo } from "react";

import styles from "./settings.module.scss";

import ResetIcon from "../icons/reload.svg";
import AddIcon from "../icons/add.svg";
import CloseIcon from "../icons/close.svg";
import CopyIcon from "../icons/copy.svg";
import ClearIcon from "../icons/clear.svg";
import LoadingIcon from "../icons/three-dots.svg";
import EditIcon from "../icons/edit.svg";
import FireIcon from "../icons/fire.svg";
import EyeIcon from "../icons/eye.svg";
import DownloadIcon from "../icons/download.svg";
import UploadIcon from "../icons/upload.svg";
import ConfigIcon from "../icons/config.svg";
import ConfirmIcon from "../icons/confirm.svg";

import ConnectionIcon from "../icons/connection.svg";
import CloudSuccessIcon from "../icons/cloud-success.svg";
import CloudFailIcon from "../icons/cloud-fail.svg";
import {
  Input,
  List,
  ListItem,
  Modal,
  PasswordInput,
  Popover,
  Select,
  showConfirm,
  showToast,
} from "./ui-lib";
import { ModelConfigList } from "./model-config";

import { IconButton } from "./button";
import { useChatStore, Theme, useAccessStore, useAppConfig } from "../store";

import Locale, {
  AllLangs,
  ALL_LANG_OPTIONS,
  changeLang,
  getLang,
} from "../locales";
import { copyToClipboard } from "../utils";
import Link from "next/link";
import {
  Anthropic,
  OPENAI_BASE_URL,
  Path,
  RELEASE_URL,
  STORAGE_KEY,
  ServiceProvider,
  SlotID,
  Stability,
} from "../constant";

import { ErrorBoundary } from "./error";
import { InputRange } from "./input-range";
import { useNavigate } from "react-router-dom";
import { getClientConfig } from "../config/client";
import { useSyncStore } from "../store/sync";
import { nanoid } from "nanoid";

import { ProviderType } from "../utils/cloud";

function DangerItems() {
  const chatStore = useChatStore();
  const appConfig = useAppConfig();

  return (
    <List>
      <ListItem
        title={Locale.Settings.Danger.Reset.Title}
        subTitle={Locale.Settings.Danger.Reset.SubTitle}
      >
        <IconButton
          aria={Locale.Settings.Danger.Reset.Title}
          text={Locale.Settings.Danger.Reset.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Reset.Confirm)) {
              appConfig.reset();
            }
          }}
          type="danger"
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.Danger.Clear.Title}
        subTitle={Locale.Settings.Danger.Clear.SubTitle}
      >
        <IconButton
          aria={Locale.Settings.Danger.Clear.Title}
          text={Locale.Settings.Danger.Clear.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Clear.Confirm)) {
              chatStore.clearAllData();
            }
          }}
          type="danger"
        />
      </ListItem>
    </List>
  );
}

function CheckButton() {
  const syncStore = useSyncStore();

  const couldCheck = useMemo(() => {
    return syncStore.cloudSync();
  }, [syncStore]);

  const [checkState, setCheckState] = useState<
    "none" | "checking" | "success" | "failed"
  >("none");

  async function check() {
    setCheckState("checking");
    const valid = await syncStore.check();
    setCheckState(valid ? "success" : "failed");
  }

  if (!couldCheck) return null;

  return (
    <IconButton
      text={Locale.Settings.Sync.Config.Modal.Check}
      bordered
      onClick={check}
      icon={
        checkState === "none" ? (
          <ConnectionIcon />
        ) : checkState === "checking" ? (
          <LoadingIcon />
        ) : checkState === "success" ? (
          <CloudSuccessIcon />
        ) : checkState === "failed" ? (
          <CloudFailIcon />
        ) : (
          <ConnectionIcon />
        )
      }
    ></IconButton>
  );
}

function SyncConfigModal(props: { onClose?: () => void }) {
  const syncStore = useSyncStore();

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Settings.Sync.Config.Modal.Title}
        onClose={() => props.onClose?.()}
        actions={[
          <CheckButton key="check" />,
          <IconButton
            key="confirm"
            onClick={props.onClose}
            icon={<ConfirmIcon />}
            bordered
            text={Locale.UI.Confirm}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Settings.Sync.Config.SyncType.Title}
            subTitle={Locale.Settings.Sync.Config.SyncType.SubTitle}
          >
            <select
              value={syncStore.provider}
              onChange={(e) => {
                syncStore.update(
                  (config) =>
                    (config.provider = e.target.value as ProviderType),
                );
              }}
            >
              {Object.entries(ProviderType).map(([k, v]) => (
                <option value={v} key={k}>
                  {k}
                </option>
              ))}
            </select>
          </ListItem>

          <ListItem
            title={Locale.Settings.Sync.Config.Proxy.Title}
            subTitle={Locale.Settings.Sync.Config.Proxy.SubTitle}
          >
            <input
              type="checkbox"
              checked={syncStore.useProxy}
              onChange={(e) => {
                syncStore.update(
                  (config) => (config.useProxy = e.currentTarget.checked),
                );
              }}
            ></input>
          </ListItem>
          {syncStore.useProxy ? (
            <ListItem
              title={Locale.Settings.Sync.Config.ProxyUrl.Title}
              subTitle={Locale.Settings.Sync.Config.ProxyUrl.SubTitle}
            >
              <input
                type="text"
                value={syncStore.proxyUrl}
                onChange={(e) => {
                  syncStore.update(
                    (config) => (config.proxyUrl = e.currentTarget.value),
                  );
                }}
              ></input>
            </ListItem>
          ) : null}
        </List>

        {syncStore.provider === ProviderType.WebDAV && (
          <>
            <List>
              <ListItem title={Locale.Settings.Sync.Config.WebDav.Endpoint}>
                <input
                  type="text"
                  value={syncStore.webdav.endpoint}
                  onChange={(e) => {
                    syncStore.update(
                      (config) =>
                        (config.webdav.endpoint = e.currentTarget.value),
                    );
                  }}
                ></input>
              </ListItem>

              <ListItem title={Locale.Settings.Sync.Config.WebDav.UserName}>
                <input
                  type="text"
                  value={syncStore.webdav.username}
                  onChange={(e) => {
                    syncStore.update(
                      (config) =>
                        (config.webdav.username = e.currentTarget.value),
                    );
                  }}
                ></input>
              </ListItem>
              <ListItem title={Locale.Settings.Sync.Config.WebDav.Password}>
                <PasswordInput
                  value={syncStore.webdav.password}
                  onChange={(e) => {
                    syncStore.update(
                      (config) =>
                        (config.webdav.password = e.currentTarget.value),
                    );
                  }}
                ></PasswordInput>
              </ListItem>
            </List>
          </>
        )}

        {syncStore.provider === ProviderType.UpStash && (
          <List>
            <ListItem title={Locale.Settings.Sync.Config.UpStash.Endpoint}>
              <input
                type="text"
                value={syncStore.upstash.endpoint}
                onChange={(e) => {
                  syncStore.update(
                    (config) =>
                      (config.upstash.endpoint = e.currentTarget.value),
                  );
                }}
              ></input>
            </ListItem>

            <ListItem title={Locale.Settings.Sync.Config.UpStash.UserName}>
              <input
                type="text"
                value={syncStore.upstash.username}
                placeholder={STORAGE_KEY}
                onChange={(e) => {
                  syncStore.update(
                    (config) =>
                      (config.upstash.username = e.currentTarget.value),
                  );
                }}
              ></input>
            </ListItem>
            <ListItem title={Locale.Settings.Sync.Config.UpStash.Password}>
              <PasswordInput
                value={syncStore.upstash.apiKey}
                onChange={(e) => {
                  syncStore.update(
                    (config) => (config.upstash.apiKey = e.currentTarget.value),
                  );
                }}
              ></PasswordInput>
            </ListItem>
          </List>
        )}
      </Modal>
    </div>
  );
}

function SyncItems() {
  const syncStore = useSyncStore();
  const chatStore = useChatStore();

  const couldSync = useMemo(() => {
    return syncStore.cloudSync();
  }, [syncStore]);

  const [showSyncConfigModal, setShowSyncConfigModal] = useState(false);

  const stateOverview = useMemo(() => {
    const sessions = chatStore.sessions;
    const messageCount = sessions.reduce((p, c) => p + c.messages.length, 0);

    return {
      chat: sessions.length,
      message: messageCount,
      mask: 0,
    };
  }, [chatStore.sessions]);

  return (
    <>
      <List>
        <ListItem
          title={Locale.Settings.Sync.CloudState}
          subTitle={
            syncStore.lastProvider
              ? `${new Date(syncStore.lastSyncTime).toLocaleString()} [${
                  syncStore.lastProvider
                }]`
              : Locale.Settings.Sync.NotSyncYet
          }
        >
          <div style={{ display: "flex" }}>
            <IconButton
              aria={Locale.Settings.Sync.CloudState + Locale.UI.Config}
              icon={<ConfigIcon />}
              text={Locale.UI.Config}
              onClick={() => {
                setShowSyncConfigModal(true);
              }}
            />
            {couldSync && (
              <IconButton
                icon={<ResetIcon />}
                text={Locale.UI.Sync}
                onClick={async () => {
                  try {
                    await syncStore.sync();
                    showToast(Locale.Settings.Sync.Success);
                  } catch (e) {
                    showToast(Locale.Settings.Sync.Fail);
                    console.error("[Sync]", e);
                  }
                }}
              />
            )}
          </div>
        </ListItem>

        <ListItem
          title={Locale.Settings.Sync.LocalState}
          subTitle={Locale.Settings.Sync.Overview(stateOverview)}
        >
          <div style={{ display: "flex" }}>
            <IconButton
              aria={Locale.Settings.Sync.LocalState + Locale.UI.Export}
              icon={<UploadIcon />}
              text={Locale.UI.Export}
              onClick={() => {
                syncStore.export();
              }}
            />
            <IconButton
              aria={Locale.Settings.Sync.LocalState + Locale.UI.Import}
              icon={<DownloadIcon />}
              text={Locale.UI.Import}
              onClick={() => {
                syncStore.import();
              }}
            />
          </div>
        </ListItem>
      </List>

      {showSyncConfigModal && (
        <SyncConfigModal onClose={() => setShowSyncConfigModal(false)} />
      )}
    </>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const config = useAppConfig();
  const updateConfig = config.update;

  const accessStore = useAccessStore();
  const shouldHideBalanceQuery = useMemo(() => {
    const isOpenAiUrl = accessStore.openaiUrl.includes(OPENAI_BASE_URL);

    return accessStore.hideBalanceQuery || isOpenAiUrl;
  }, [accessStore.hideBalanceQuery, accessStore.openaiUrl]);

  const enabledAccessControl = useMemo(
    () => accessStore.enabledAccessControl(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const keydownEvent = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        navigate(Path.Home);
      }
    };
    if (clientConfig?.isApp) {
      // Force to set custom endpoint to true if it's app
      accessStore.update((state) => {
        state.useCustomConfig = true;
      });
    }
    document.addEventListener("keydown", keydownEvent);
    return () => {
      document.removeEventListener("keydown", keydownEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientConfig = useMemo(() => getClientConfig(), []);
  const showAccessCode = enabledAccessControl && !clientConfig?.isApp;

  const accessCodeComponent = showAccessCode && (
    <ListItem
      title={Locale.Settings.Access.AccessCode.Title}
      subTitle={Locale.Settings.Access.AccessCode.SubTitle}
    >
      <PasswordInput
        value={accessStore.accessCode}
        type="text"
        placeholder={Locale.Settings.Access.AccessCode.Placeholder}
        onChange={(e) => {
          accessStore.update(
            (access) => (access.accessCode = e.currentTarget.value),
          );
        }}
      />
    </ListItem>
  );

  const useCustomConfigComponent = // Conditionally render the following ListItem based on clientConfig.isApp
    !clientConfig?.isApp && ( // only show if isApp is false
      <ListItem
        title={Locale.Settings.Access.CustomEndpoint.Title}
        subTitle={Locale.Settings.Access.CustomEndpoint.SubTitle}
      >
        <input
          aria-label={Locale.Settings.Access.CustomEndpoint.Title}
          type="checkbox"
          checked={accessStore.useCustomConfig}
          onChange={(e) =>
            accessStore.update(
              (access) => (access.useCustomConfig = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
    );

  const openAIConfigComponent = accessStore.provider ===
    ServiceProvider.OpenAI && (
    <>
      <ListItem
        title={Locale.Settings.Access.OpenAI.Endpoint.Title}
        subTitle={Locale.Settings.Access.OpenAI.Endpoint.SubTitle}
      >
        <input
          aria-label={Locale.Settings.Access.OpenAI.Endpoint.Title}
          type="text"
          value={accessStore.openaiUrl}
          placeholder={OPENAI_BASE_URL}
          onChange={(e) =>
            accessStore.update(
              (access) => (access.openaiUrl = e.currentTarget.value),
            )
          }
        ></input>
      </ListItem>
      <ListItem
        title={Locale.Settings.Access.OpenAI.ApiKey.Title}
        subTitle={Locale.Settings.Access.OpenAI.ApiKey.SubTitle}
      >
        <PasswordInput
          aria={Locale.Settings.ShowPassword}
          aria-label={Locale.Settings.Access.OpenAI.ApiKey.Title}
          value={accessStore.openaiApiKey}
          type="text"
          placeholder={Locale.Settings.Access.OpenAI.ApiKey.Placeholder}
          onChange={(e) => {
            accessStore.update(
              (access) => (access.openaiApiKey = e.currentTarget.value),
            );
          }}
        />
      </ListItem>
    </>
  );

  const anthropicConfigComponent = accessStore.provider ===
    ServiceProvider.Anthropic && (
    <>
      <ListItem
        title={Locale.Settings.Access.Anthropic.Endpoint.Title}
        subTitle={
          Locale.Settings.Access.Anthropic.Endpoint.SubTitle +
          Anthropic.ExampleEndpoint
        }
      >
        <input
          aria-label={Locale.Settings.Access.Anthropic.Endpoint.Title}
          type="text"
          value={accessStore.anthropicUrl}
          placeholder={Anthropic.ExampleEndpoint}
          onChange={(e) =>
            accessStore.update(
              (access) => (access.anthropicUrl = e.currentTarget.value),
            )
          }
        ></input>
      </ListItem>
      <ListItem
        title={Locale.Settings.Access.Anthropic.ApiKey.Title}
        subTitle={Locale.Settings.Access.Anthropic.ApiKey.SubTitle}
      >
        <PasswordInput
          aria-label={Locale.Settings.Access.Anthropic.ApiKey.Title}
          value={accessStore.anthropicApiKey}
          type="text"
          placeholder={Locale.Settings.Access.Anthropic.ApiKey.Placeholder}
          onChange={(e) => {
            accessStore.update(
              (access) => (access.anthropicApiKey = e.currentTarget.value),
            );
          }}
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.Access.Anthropic.ApiVerion.Title}
        subTitle={Locale.Settings.Access.Anthropic.ApiVerion.SubTitle}
      >
        <input
          aria-label={Locale.Settings.Access.Anthropic.ApiVerion.Title}
          type="text"
          value={accessStore.anthropicApiVersion}
          placeholder={Anthropic.Vision}
          onChange={(e) =>
            accessStore.update(
              (access) => (access.anthropicApiVersion = e.currentTarget.value),
            )
          }
        ></input>
      </ListItem>
    </>
  );

  const stabilityConfigComponent = accessStore.provider ===
    ServiceProvider.Stability && (
    <>
      <ListItem
        title={Locale.Settings.Access.Stability.Endpoint.Title}
        subTitle={
          Locale.Settings.Access.Stability.Endpoint.SubTitle +
          Stability.ExampleEndpoint
        }
      >
        <input
          aria-label={Locale.Settings.Access.Stability.Endpoint.Title}
          type="text"
          value={accessStore.stabilityUrl}
          placeholder={Stability.ExampleEndpoint}
          onChange={(e) =>
            accessStore.update(
              (access) => (access.stabilityUrl = e.currentTarget.value),
            )
          }
        ></input>
      </ListItem>
      <ListItem
        title={Locale.Settings.Access.Stability.ApiKey.Title}
        subTitle={Locale.Settings.Access.Stability.ApiKey.SubTitle}
      >
        <PasswordInput
          aria-label={Locale.Settings.Access.Stability.ApiKey.Title}
          value={accessStore.stabilityApiKey}
          type="text"
          placeholder={Locale.Settings.Access.Stability.ApiKey.Placeholder}
          onChange={(e) => {
            accessStore.update(
              (access) => (access.stabilityApiKey = e.currentTarget.value),
            );
          }}
        />
      </ListItem>
    </>
  );

  return (
    <ErrorBoundary>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">
            {Locale.Settings.Title}
          </div>
          <div className="window-header-sub-title">
            {Locale.Settings.SubTitle}
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button"></div>
          <div className="window-action-button"></div>
          <div className="window-action-button">
            <IconButton
              aria={Locale.UI.Close}
              icon={<CloseIcon />}
              onClick={() => navigate(Path.Home)}
              bordered
            />
          </div>
        </div>
      </div>
      <div className={styles["settings"]}>
        <List>{accessCodeComponent}</List>

        <SyncItems />

        <List>
          <ModelConfigList
            modelConfig={config.modelConfig}
            updateConfig={(updater) => {
              const modelConfig = { ...config.modelConfig };
              updater(modelConfig);
              config.update((config) => (config.modelConfig = modelConfig));
            }}
          />
        </List>

        <List>
          <ListItem
            title="启用代码折叠"
            subTitle="启用之后可以自动折叠/展开过长的代码块"
          >
            <input
              aria-label="启用代码折叠"
              type="checkbox"
              checked={config.enableCodeFold}
              data-testid="enable-code-fold-checkbox"
              onChange={(e) =>
                updateConfig(
                  (config) => (config.enableCodeFold = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>

          {/* <ListItem
            title={Locale.Mask.Config.Artifacts.Title}
            subTitle={Locale.Mask.Config.Artifacts.SubTitle}
          >
            <input
              aria-label={Locale.Mask.Config.Artifacts.Title}
              type="checkbox"
              checked={config.enableArtifacts}
              onChange={(e) =>
                updateConfig(
                  (config) =>
                    (config.enableArtifacts = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem> */}
        </List>

        {/* <List>
          
        </List> */}

        {/* <DangerItems /> */}
      </div>
    </ErrorBoundary>
  );
}
