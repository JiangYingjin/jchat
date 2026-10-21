"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
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

function extractPairCode(value: string): string | null {
  const text = value.trim().toUpperCase();
  if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(text)) return text;
  try {
    const url = new URL(value);
    const match = url.hash.match(
      /^#PAIR=([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12})$/i,
    );
    if (
      typeof window !== "undefined" &&
      url.origin === window.location.origin &&
      url.pathname === "/settings" &&
      match
    ) {
      return match[1].toUpperCase();
    }
  } catch {
    // 扫描结果不是 URL 时继续返回无效码。
  }
  return null;
}

const PAIR_CODE_SESSION_KEY = "jchat:device-transfer:pair-code";

function PairCodeScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let stopScanning: (() => void) | undefined;
    void import("@zxing/browser")
      .then(({ BrowserQRCodeReader }) => {
        if (!videoRef.current) throw new Error("摄像头预览尚未准备好");
        const reader = new BrowserQRCodeReader();
        return reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (!result || disposed) return;
            disposed = true;
            onCode(result.getText());
          },
        );
      })
      .then((controls) => {
        stopScanning = () => controls.stop();
        if (disposed) controls.stop();
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? cause.message
              : "无法启动摄像头，请检查浏览器权限或手动输入配对码",
          );
        }
      });

    return () => {
      disposed = true;
      stopScanning?.();
    };
  }, [onCode]);

  return (
    <div className="modal-mask">
      <Modal
        title="扫描配对二维码"
        onClose={onClose}
        actions={[
          <IconButton
            key="close-scanner"
            text="关闭"
            onClick={onClose}
            bordered
          />,
        ]}
      >
        <div className={styles["device-transfer-scanner"]}>
          <video ref={videoRef} playsInline muted />
          <p>{error || "将另一台设备上的二维码放入取景框"}</p>
        </div>
      </Modal>
    </div>
  );
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
  const [pairExpiresAt, setPairExpiresAt] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [qrImage, setQrImage] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
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
          paired: event.paired === true,
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
      if (event.type === "pair.revoked") {
        setPairCode("");
        setPairExpiresAt(0);
        window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
      }
      if (event.type === "status" && event.paired === true) {
        setPairCode("");
        setPairExpiresAt(0);
        window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
      }
    });
  }, []);

  useEffect(() => {
    const encoded = window.sessionStorage.getItem(PAIR_CODE_SESSION_KEY);
    if (encoded) {
      try {
        const value = JSON.parse(encoded) as {
          code?: string;
          expiresAt?: number;
        };
        if (
          typeof value.code === "string" &&
          typeof value.expiresAt === "number" &&
          value.expiresAt > Date.now() &&
          extractPairCode(value.code)
        ) {
          setPairCode(value.code);
          setPairExpiresAt(value.expiresAt);
        } else {
          window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
        }
      } catch {
        window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
      }
    }
    const fromQr = extractPairCode(window.location.href);
    if (fromQr) {
      setCodeInput(fromQr);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  useEffect(() => {
    if (!pairCode || !pairExpiresAt) {
      setQrImage("");
      setSecondsRemaining(0);
      return;
    }
    const updateRemaining = () =>
      setSecondsRemaining(
        Math.max(0, Math.ceil((pairExpiresAt - Date.now()) / 1000)),
      );
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    let active = true;
    const pairUrl = new URL("/settings", window.location.origin);
    pairUrl.hash = `pair=${pairCode}`;
    void QRCode.toDataURL(pairUrl.toString(), {
      width: 216,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((image) => {
        if (active) setQrImage(image);
      })
      .catch(() => {
        if (active) setQrImage("");
      });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pairCode, pairExpiresAt]);

  const createPairing = async () => {
    setBusy(true);
    try {
      const result = await deviceTransferClient.createPairing();
      setPairCode(result.pairCode);
      const expiresAt = Date.now() + result.expiresIn * 1000;
      setPairExpiresAt(expiresAt);
      window.sessionStorage.setItem(
        PAIR_CODE_SESSION_KEY,
        JSON.stringify({ code: result.pairCode, expiresAt }),
      );
      setStatus(deviceTransferClient.getStatus());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配对码生成失败");
    } finally {
      setBusy(false);
    }
  };

  const joinPairing = async () => {
    const code = extractPairCode(codeInput) ?? codeInput.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    try {
      await deviceTransferClient.joinPairing(code);
      setCodeInput("");
      window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
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
    const question = status.paired
      ? "解除配对后，双方需要重新配对才能传送会话。继续吗？"
      : "取消当前配对码后，对方将无法继续使用它。继续吗？";
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await deviceTransferClient.forgetPair();
      setPairCode("");
      setPairExpiresAt(0);
      window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
      setStatus(deviceTransferClient.getStatus());
      showToast(status.paired ? "设备配对已解除" : "配对码已取消");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "解除配对失败");
    } finally {
      setBusy(false);
    }
  };

  const switchToScanner = async () => {
    if (
      !window.confirm(
        "取消本机配对码后，对方将无法继续使用它。是否改为扫描对端二维码？",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deviceTransferClient.forgetPair();
      setPairCode("");
      setPairExpiresAt(0);
      window.sessionStorage.removeItem(PAIR_CODE_SESSION_KEY);
      setStatus(deviceTransferClient.getStatus());
      setScannerOpen(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "切换配对方式失败");
    } finally {
      setBusy(false);
    }
  };

  const onScannedCode = useCallback((value: string) => {
    const code = extractPairCode(value);
    setScannerOpen(false);
    if (!code) {
      showToast("没有识别到有效的 JChat 配对二维码");
      return;
    }
    setCodeInput(code);
  }, []);

  return (
    <>
      <List>
        <ListItem
          title={Locale.Settings.DeviceTransfer.Title}
          subTitle={
            status.paired
              ? status.peerOnline
                ? "已配对 · 对端在线"
                : status.connecting
                  ? "已配对 · 正在连接对端…"
                  : "已配对 · 对端离线"
              : status.connecting
                ? "正在连接配对服务…"
                : "尚未配对 · 电脑和手机可以任选一端发起配对"
          }
          vertical
        >
          {status.paired ? (
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
          ) : status.configured ? (
            <div className={styles["device-transfer-pairing"]}>
              {pairCode ? (
                <div className={styles["device-transfer-pair-card"]}>
                  {qrImage ? (
                    <img src={qrImage} alt="JChat 配对二维码" />
                  ) : (
                    <div
                      className={styles["device-transfer-qr-fallback"]}
                      role="img"
                      aria-label="二维码生成失败，请使用下方配对码"
                    >
                      二维码暂不可用
                    </div>
                  )}
                  <div>
                    <strong>让另一台设备扫描</strong>
                    <span>对方确认后才会建立配对</span>
                    <code>{pairCode}</code>
                    <span>
                      {secondsRemaining > 0
                        ? `配对码 ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")} 后过期`
                        : "配对码已过期，请刷新二维码"}
                    </span>
                  </div>
                </div>
              ) : (
                <p className={styles["device-transfer-status"]}>
                  此设备尚未配对。生成二维码后，请在另一台设备扫描或输入配对码。
                </p>
              )}
              <div className={styles["device-transfer-actions"]}>
                <IconButton
                  text={pairCode ? "刷新二维码" : "显示配对二维码"}
                  onClick={() => void createPairing()}
                  disabled={busy}
                  type="primary"
                  bordered
                />
                <IconButton
                  text="改为扫描对端二维码"
                  onClick={() => void switchToScanner()}
                  disabled={busy}
                  bordered
                />
              </div>
            </div>
          ) : (
            <div className={styles["device-transfer-actions"]}>
              <IconButton
                text="扫描配对二维码"
                onClick={() => setScannerOpen(true)}
                disabled={busy}
                type="primary"
                bordered
              />
              <span className={styles["device-transfer-divider"]}>或</span>
              <input
                className={styles["device-transfer-code"]}
                value={codeInput}
                onChange={(event) =>
                  setCodeInput(event.target.value.toUpperCase())
                }
                placeholder="输入 12 位配对码"
                maxLength={12}
                autoComplete="one-time-code"
                aria-label="配对码"
              />
              <IconButton
                text="连接设备"
                onClick={() => void joinPairing()}
                disabled={busy || !codeInput.trim()}
                bordered
              />
              <IconButton
                text="在本设备生成二维码"
                onClick={() => void createPairing()}
                disabled={busy}
                bordered
              />
            </div>
          )}
        </ListItem>
      </List>

      {scannerOpen && (
        <PairCodeScanner
          onCode={onScannedCode}
          onClose={() => setScannerOpen(false)}
        />
      )}

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
