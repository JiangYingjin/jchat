"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { buildFullSharePayload, type FullSharePayload } from "../utils/share";
import { messageStorage } from "../store/message";
import {
  deviceTransferClient,
  type DeviceTransferEvent,
  type RemoteSessionSummary,
  type TransferStatus,
  MAX_TRANSFER_BYTES,
} from "../utils/device-transfer";
import { useChatStore } from "../store/chat";
import { systemMessageStorage } from "../store/system";
import { IconButton } from "./button";
import { List, ListItem, Modal, showToast } from "./ui-lib";
import Locale from "../locales";
import styles from "../styles/settings.module.scss";

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
          <p>
            {error || "将另一台设备上的二维码放入取景框，识别后立即完成配对"}
          </p>
        </div>
      </Modal>
    </div>
  );
}

function findSession(sessionId: string) {
  const chat = useChatStore.getState();
  return (
    chat.groupSessions[sessionId] ||
    chat.sessions.find((session) => session.id === sessionId)
  );
}

async function buildRecentSessionSummaries(): Promise<RemoteSessionSummary[]> {
  if (
    typeof window === "undefined" ||
    (window as any).__jchat_data_restored !== true
  ) {
    throw new Error("本机聊天数据尚未恢复完成");
  }
  const chat = useChatStore.getState();
  const sessions = new Map<string, (typeof chat.sessions)[number]>();
  for (const session of [
    ...chat.sessions,
    ...Object.values(chat.groupSessions),
  ]) {
    if (session?.id && !sessions.has(session.id))
      sessions.set(session.id, session);
  }
  return Array.from(sessions.values())
    .filter((session) => session.messageCount > 0)
    .sort((left, right) => right.lastUpdate - left.lastUpdate)
    .slice(0, 5)
    .map((session) => ({
      id: session.id,
      title: session.title || "未命名会话",
      messageCount: session.messageCount,
      lastUpdate: session.lastUpdate,
    }));
}

async function buildSessionSnapshot(
  sessionId: string,
): Promise<FullSharePayload> {
  if (
    typeof window === "undefined" ||
    (window as any).__jchat_data_restored !== true
  ) {
    throw new Error("本机聊天数据尚未恢复完成");
  }
  const session = findSession(sessionId);
  if (!session?.id) {
    throw new Error("对端请求的会话已不存在，请刷新最近会话列表");
  }
  const messages = await messageStorage.get(session.id);
  if (!messages.length) throw new Error("所选会话没有可传送的消息");
  if (messages.some((message) => message.streaming)) {
    throw new Error("所选会话仍在生成内容，请稍后再试");
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

/** 全局在线连接与对端目录/传送处理；无论用户当前在哪个页面都能响应请求。 */
export function DeviceTransferRuntime() {
  const [transferProgress, setTransferProgress] = useState("");

  const sendRequestedSession = useCallback(
    async (transferId: string, sessionId: string) => {
      try {
        setTransferProgress("正在准备所选会话…");
        const snapshot = await buildSessionSnapshot(sessionId);
        setTransferProgress("正在发送所选会话…");
        await deviceTransferClient.sendSnapshot(transferId, snapshot);
        setTransferProgress("");
        showToast("所选会话已传送给对端");
      } catch (error) {
        setTransferProgress("");
        deviceTransferClient.cancelTransfer();
        showToast(error instanceof Error ? error.message : "会话传送失败");
      }
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = deviceTransferClient.subscribe((event) => {
      if (event.type === "sessions.list.request") {
        void buildRecentSessionSummaries()
          .then((sessions) =>
            deviceTransferClient.respondSessionList(event.requestId, sessions),
          )
          .catch((error) => {
            deviceTransferClient.respondSessionList(event.requestId, []);
            showToast(
              error instanceof Error ? error.message : "读取会话列表失败",
            );
          });
      }
      if (event.type === "transfer.request") {
        void sendRequestedSession(event.transferId, event.sessionId);
      }
      if (event.type === "sending-progress") {
        const percent = Math.floor(
          (event.sentBytes / Math.max(event.totalBytes, 1)) * 100,
        );
        setTransferProgress(`正在发送所选会话 ${percent}%`);
      }
      if (event.type === "transfer.error") {
        setTransferProgress("");
        if (event.reason) showToast(event.reason);
      }
      if (event.type === "pair.revoked") {
        setTransferProgress("");
      }
    });
    void deviceTransferClient.initialize().catch((error) => {
      console.warn("跨设备连接未能启动", error);
    });
    return () => {
      unsubscribe();
      deviceTransferClient.dispose();
    };
  }, [sendRequestedSession]);

  return (
    <>
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
  const [pendingQrPairCode, setPendingQrPairCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [peerSessions, setPeerSessions] = useState<RemoteSessionSummary[]>([]);
  const [selectedPeerSessionId, setSelectedPeerSessionId] = useState("");

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
      setPendingQrPairCode(fromQr);
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

  const joinPairing = useCallback(
    async (pairingCode?: string) => {
      const value = pairingCode ?? codeInput;
      const code = extractPairCode(value) ?? value.trim().toUpperCase();
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
    },
    [codeInput],
  );

  useEffect(() => {
    if (!pendingQrPairCode || busy || status.paired) return;
    setPendingQrPairCode("");
    void joinPairing(pendingQrPairCode);
  }, [busy, joinPairing, pendingQrPairCode, status.paired]);

  const loadPeerSessions = async () => {
    setBusy(true);
    setProgress("正在读取对端最近会话…");
    try {
      const sessions = await deviceTransferClient.requestPeerSessions();
      setPeerSessions(sessions);
      setSelectedPeerSessionId("");
      if (!sessions.length) showToast("对端没有可传送的会话");
      setProgress("");
    } catch (error) {
      setProgress("");
      showToast(error instanceof Error ? error.message : "读取对端会话失败");
    } finally {
      setBusy(false);
    }
  };

  const transferSelectedSession = async () => {
    if (!selectedPeerSessionId) {
      showToast("请先选择一个会话");
      return;
    }
    setBusy(true);
    setProgress("正在请求传送所选会话…");
    try {
      const payload = await deviceTransferClient.requestSession(
        selectedPeerSessionId,
      );
      setProgress("正在导入会话…");
      const result = await useChatStore
        .getState()
        .importTransferredSession(payload);
      if (!result.ok) throw new Error(result.error || "会话导入失败");
      setProgress("");
      setPeerSessions([]);
      setSelectedPeerSessionId("");
      showToast("所选会话已传送并导入为新会话");
    } catch (error) {
      setProgress("");
      showToast(error instanceof Error ? error.message : "会话传送失败");
    } finally {
      setBusy(false);
    }
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

  const onScannedCode = useCallback(
    (value: string) => {
      const code = extractPairCode(value);
      setScannerOpen(false);
      if (!code) {
        showToast("没有识别到有效的 JChat 配对二维码");
        return;
      }
      void joinPairing(code);
    },
    [joinPairing],
  );

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
                text="查看对端最近 5 条会话"
                onClick={() => void loadPeerSessions()}
                disabled={busy || !status.peerOnline}
                bordered
              />
              <span className={styles["device-transfer-status"]}>
                只显示摘要；选中后会自动传送并导入完整会话
              </span>
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
              {peerSessions.length > 0 && (
                <div className={styles["device-transfer-session-list"]}>
                  <strong>选择要传送到本设备的会话</strong>
                  {peerSessions.map((session) => (
                    <label
                      className={styles["device-transfer-session-option"]}
                      key={session.id}
                    >
                      <input
                        type="radio"
                        name="device-transfer-session"
                        value={session.id}
                        checked={selectedPeerSessionId === session.id}
                        onChange={() => setSelectedPeerSessionId(session.id)}
                        disabled={busy}
                      />
                      <span>
                        <strong>{session.title || "未命名会话"}</strong>
                        <small>
                          {session.messageCount} 条消息 ·{" "}
                          {new Date(session.lastUpdate).toLocaleString()}
                        </small>
                      </span>
                    </label>
                  ))}
                  <IconButton
                    text="传送到本设备"
                    onClick={() => void transferSelectedSession()}
                    disabled={busy || !selectedPeerSessionId}
                    type="primary"
                    bordered
                  />
                </div>
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
                    <span>对方扫码后立即完成配对</span>
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
    </>
  );
}
