"use client";

import { useEffect, useState } from "react";
import { buildFullSharePayload, type FullSharePayload } from "../utils/share";
import {
  deviceTransferClient,
  type DeviceTransferEvent,
  type TransferStatus,
  MAX_TRANSFER_BYTES,
} from "../utils/device-transfer";
import { useChatStore } from "../store/chat";
import { systemMessageStorage } from "../store/system";
import { IconButton } from "./button";
import { List, ListItem, Modal, showToast } from "./ui-lib";
import Locale from "../locales";
import styles from "../styles/settings.module.scss";

function deviceLabel(value: unknown): string {
  if (value === "desktop") return "电脑";
  if (value === "mobile") return "手机";
  if (value === "tablet") return "平板";
  return "另一台设备";
}

async function buildCurrentSessionSnapshot(): Promise<FullSharePayload> {
  if (
    typeof window === "undefined" ||
    (window as any).__jchat_data_restored !== true
  ) {
    throw new Error("本机聊天数据尚未恢复完成");
  }
  const chat = useChatStore.getState();
  const session = chat.currentSession();
  if (!session?.id) {
    throw new Error("当前没有可传送的会话");
  }
  const messages =
    (session.groupId && chat.groupSessions[session.id]?.messages) ||
    session.messages;
  if (messages.some((message) => message.streaming)) {
    throw new Error("当前会话仍在生成内容，请稍后再试");
  }
  const systemPrompt = await systemMessageStorage.get(session.id);
  const snapshot = await buildFullSharePayload(
    { ...session, messages },
    systemPrompt.text.trim() || systemPrompt.images.length > 0
      ? { text: systemPrompt.text, images: systemPrompt.images }
      : null,
    { embedImages: true },
  );
  const size = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (size > MAX_TRANSFER_BYTES) {
    throw new Error("当前会话超过 50 MiB 传送上限，请先移除较大的图片或文件");
  }
  return snapshot;
}

/** 全局在线连接与接收端授权弹窗；无论用户当前在哪个页面都能响应对端请求。 */
export function DeviceTransferRuntime() {
  const [pairRequest, setPairRequest] = useState<DeviceTransferEvent | null>(
    null,
  );
  const [transferRequest, setTransferRequest] =
    useState<DeviceTransferEvent | null>(null);
  const [transferProgress, setTransferProgress] = useState("");

  useEffect(() => {
    const unsubscribe = deviceTransferClient.subscribe((event) => {
      if (event.type === "pair.request") setPairRequest(event);
      if (event.type === "transfer.request") setTransferRequest(event);
      if (event.type === "sending-progress") {
        const percent = Math.floor(
          (event.sentBytes / Math.max(event.totalBytes, 1)) * 100,
        );
        setTransferProgress(`正在发送当前会话 ${percent}%`);
      }
      if (event.type === "transfer.error") setTransferProgress("");
      if (event.type === "pair.revoked") {
        setPairRequest(null);
        setTransferRequest(null);
      }
    });
    void deviceTransferClient.initialize().catch((error) => {
      console.warn("跨设备连接未能启动", error);
    });
    return () => {
      unsubscribe();
      deviceTransferClient.dispose();
    };
  }, []);

  const resolvePair = async (approve: boolean) => {
    const pending = pairRequest;
    setPairRequest(null);
    if (!pending) return;
    try {
      await deviceTransferClient.resolvePairRequest(pending.requestId, approve);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配对处理失败");
    }
  };

  const resolveTransfer = async (approve: boolean) => {
    const pending = transferRequest;
    setTransferRequest(null);
    if (!pending) return;
    try {
      await deviceTransferClient.resolveTransferRequest(
        pending.transferId,
        approve,
      );
      if (!approve) return;
      setTransferProgress("正在准备当前会话…");
      const snapshot = await buildCurrentSessionSnapshot();
      setTransferProgress("正在发送当前会话…");
      await deviceTransferClient.sendSnapshot(pending.transferId, snapshot);
      setTransferProgress("");
      showToast("当前会话已发送给对端");
    } catch (error) {
      setTransferProgress("");
      deviceTransferClient.cancelTransfer();
      showToast(error instanceof Error ? error.message : "会话传送失败");
    }
  };

  return (
    <>
      {pairRequest && (
        <div className="modal-mask">
          <Modal
            title="新设备配对请求"
            onClose={() => void resolvePair(false)}
            actions={[
              <IconButton
                key="deny"
                text="拒绝"
                onClick={() => void resolvePair(false)}
                bordered
              />,
              <IconButton
                key="approve"
                text="确认配对"
                type="primary"
                onClick={() => void resolvePair(true)}
                bordered
              />,
            ]}
          >
            <p>{deviceLabel(pairRequest.deviceType)}希望与本设备配对。</p>
            <p>配对后双方都可以向对方请求当前会话。</p>
          </Modal>
        </div>
      )}
      {transferRequest && (
        <div className="modal-mask">
          <Modal
            title="跨设备会话请求"
            onClose={() => void resolveTransfer(false)}
            actions={[
              <IconButton
                key="deny"
                text="拒绝"
                onClick={() => void resolveTransfer(false)}
                bordered
              />,
              <IconButton
                key="approve"
                text="发送当前会话"
                type="primary"
                onClick={() => void resolveTransfer(true)}
                bordered
              />,
            ]}
          >
            <p>
              {deviceLabel(transferRequest.fromDevice)}请求获取本机当前会话。
            </p>
            <p>确认后会发送完整会话内容，包括系统提示词、消息和图片。</p>
          </Modal>
        </div>
      )}
      {transferProgress && (
        <div className="modal-mask">
          <Modal
            title="跨设备会话传送"
            onClose={() => {
              deviceTransferClient.cancelTransfer();
              setTransferProgress("");
            }}
            actions={[
              <IconButton
                key="cancel-transfer"
                text="取消传送"
                onClick={() => {
                  deviceTransferClient.cancelTransfer();
                  setTransferProgress("");
                }}
                bordered
              />,
            ]}
          >
            <p>{transferProgress}</p>
          </Modal>
        </div>
      )}
    </>
  );
}

export function DeviceTransferSettings() {
  const [status, setStatus] = useState(deviceTransferClient.getStatus());
  const [pairCode, setPairCode] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [receivedPayload, setReceivedPayload] =
    useState<FullSharePayload | null>(null);

  useEffect(() => {
    setStatus(deviceTransferClient.getStatus());
    return deviceTransferClient.subscribe((event) => {
      if (event.type === "status") {
        setStatus({
          configured: event.configured === true,
          connected: event.connected === true,
          peerOnline: event.peerOnline === true,
          connecting: event.connecting === true,
        });
      }
      if (event.type === "receiving-progress") {
        const percentage = Math.floor(
          (event.receivedBytes / Math.max(event.totalBytes, 1)) * 100,
        );
        setProgress(`正在接收会话 ${percentage}%`);
      }
      if (event.type === "sending-progress") {
        const percentage = Math.floor(
          (event.sentBytes / Math.max(event.totalBytes, 1)) * 100,
        );
        setProgress(`正在发送会话 ${percentage}%`);
      }
      if (event.type === "transfer.approved") setProgress("对端正在准备会话…");
      if (event.type === "transfer.error") setProgress("");
    });
  }, []);

  const createPairing = async () => {
    setBusy(true);
    setPairCode("");
    try {
      const result = await deviceTransferClient.createPairing();
      setPairCode(result.pairCode);
      setStatus(deviceTransferClient.getStatus());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配对码生成失败");
    } finally {
      setBusy(false);
    }
  };

  const joinPairing = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    try {
      await deviceTransferClient.joinPairing(code);
      setCodeInput("");
      setStatus(deviceTransferClient.getStatus());
      showToast("设备配对成功");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配对失败");
    } finally {
      setBusy(false);
    }
  };

  const requestSession = async () => {
    setBusy(true);
    setProgress("等待对端确认");
    try {
      const payload = await deviceTransferClient.requestSession();
      setReceivedPayload(payload);
      setProgress("");
    } catch (error) {
      setProgress("");
      showToast(error instanceof Error ? error.message : "会话请求失败");
    } finally {
      setBusy(false);
    }
  };

  const importSession = async () => {
    if (!receivedPayload) return;
    const result = await useChatStore
      .getState()
      .importTransferredSession(receivedPayload);
    if (!result.ok) {
      showToast(result.error || "会话导入失败");
      return;
    }
    setReceivedPayload(null);
    showToast("会话已导入为新会话");
  };

  const forgetPair = async () => {
    if (!window.confirm("解除配对后，双方需要重新配对才能传送会话。继续吗？"))
      return;
    setBusy(true);
    try {
      await deviceTransferClient.forgetPair();
      setPairCode("");
      setStatus(deviceTransferClient.getStatus());
      showToast("设备配对已解除");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "解除配对失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <List>
        <ListItem
          title={Locale.Settings.DeviceTransfer.Title}
          subTitle={
            status.configured
              ? status.peerOnline
                ? "已配对，对端在线"
                : status.connecting
                  ? "正在连接对端…"
                  : "已配对，对端当前离线"
              : "电脑和手机完成配对后，双方都可以互相请求当前会话"
          }
          vertical
        >
          {status.configured ? (
            <div className={styles["device-transfer-actions"]}>
              <IconButton
                text="向对端请求会话"
                onClick={() => void requestSession()}
                disabled={busy || !status.peerOnline}
                bordered
              />
              <IconButton
                text="解除配对"
                onClick={() => void forgetPair()}
                disabled={busy}
                bordered
              />
              {progress && (
                <span className={styles["device-transfer-status"]}>
                  {progress}
                </span>
              )}
            </div>
          ) : (
            <div className={styles["device-transfer-actions"]}>
              <IconButton
                text="生成配对码"
                onClick={() => void createPairing()}
                disabled={busy}
                bordered
              />
              <span className={styles["device-transfer-divider"]}>或</span>
              <input
                className={styles["device-transfer-code"]}
                value={codeInput}
                onChange={(event) =>
                  setCodeInput(event.target.value.toUpperCase())
                }
                placeholder="输入另一台设备的配对码"
                maxLength={20}
                autoComplete="one-time-code"
                aria-label="配对码"
              />
              <IconButton
                text="连接设备"
                onClick={() => void joinPairing()}
                disabled={busy || !codeInput.trim()}
                bordered
              />
              {pairCode && (
                <div className={styles["device-transfer-pair-code"]}>
                  <span>请在另一台设备输入此配对码（5 分钟内有效）</span>
                  <strong>{pairCode}</strong>
                </div>
              )}
            </div>
          )}
        </ListItem>
      </List>

      {receivedPayload && (
        <div className="modal-mask">
          <Modal
            title="确认导入会话"
            onClose={() => setReceivedPayload(null)}
            actions={[
              <IconButton
                key="cancel"
                text="取消"
                onClick={() => setReceivedPayload(null)}
                bordered
              />,
              <IconButton
                key="import"
                text="导入为新会话"
                type="primary"
                onClick={() => void importSession()}
                bordered
              />,
            ]}
          >
            <p>
              {typeof receivedPayload.session.title === "string"
                ? receivedPayload.session.title
                : "未命名会话"}
            </p>
            <p>
              {receivedPayload.messages.length} 条消息，将作为新会话加入本机。
            </p>
          </Modal>
        </div>
      )}
    </>
  );
}
