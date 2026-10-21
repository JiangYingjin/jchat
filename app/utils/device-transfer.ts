"use client";

import type { FullSharePayload } from "./share";
import { deviceTransferStorage } from "../store/device-transfer";

export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;
export const TRANSFER_CHUNK_BYTES = 256 * 1024;

export type TransferStatus = {
  configured: boolean;
  paired: boolean;
  connected: boolean;
  peerOnline: boolean;
  connecting: boolean;
};

export type RemoteSessionSummary = {
  id: string;
  title: string;
  messageCount: number;
  lastUpdate: number;
};

export type DeviceTransferEvent = Record<string, any> & { type: string };
type Listener = (event: DeviceTransferEvent) => void;

type EventWaiter = {
  type: string | string[];
  predicate: (event: DeviceTransferEvent) => boolean;
  resolve: (event: DeviceTransferEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function deviceType(): "desktop" | "mobile" | "tablet" | "other" {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Android|iPhone|iPod|Mobile/i.test(ua)) return "mobile";
  if (/Windows|Macintosh|Linux|X11/i.test(ua)) return "desktop";
  return "other";
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isFullSharePayload(value: unknown): value is FullSharePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (
    payload.version !== 1 ||
    !payload.session ||
    typeof payload.session !== "object" ||
    !Array.isArray(payload.messages)
  ) {
    return false;
  }
  if (payload.systemPrompt !== null) {
    if (!payload.systemPrompt || typeof payload.systemPrompt !== "object") {
      return false;
    }
    const systemPrompt = payload.systemPrompt as Record<string, unknown>;
    if (
      typeof systemPrompt.text !== "string" ||
      !Array.isArray(systemPrompt.images) ||
      !systemPrompt.images.every((image: unknown) => typeof image === "string")
    ) {
      return false;
    }
  }
  return payload.messages.every((message) => {
    if (!message || typeof message !== "object") return false;
    const item = message as Record<string, unknown>;
    if (
      !["system", "user", "assistant"].includes(String(item.role)) ||
      !(typeof item.content === "string" || Array.isArray(item.content))
    ) {
      return false;
    }
    if (Array.isArray(item.content)) {
      return item.content.every((part) => {
        if (!part || typeof part !== "object") return false;
        const content = part as Record<string, unknown>;
        if (content.type === "text") return typeof content.text === "string";
        return (
          content.type === "image_url" &&
          Boolean(content.image_url) &&
          typeof content.image_url === "object" &&
          typeof (content.image_url as Record<string, unknown>).url === "string"
        );
      });
    }
    return true;
  });
}

class DeviceTransferClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private waiters = new Set<EventWaiter>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private stopped = false;
  private suppressReconnect = false;
  private connectingPromise: Promise<void> | null = null;
  private status: TransferStatus = {
    configured: false,
    paired: false,
    connected: false,
    peerOnline: false,
    connecting: false,
  };
  private receiveState: {
    transferId: string;
    totalBytes: number;
    totalChunks: number;
    sha256: string;
    chunks: Uint8Array[];
    receivedBytes: number;
  } | null = null;
  private activeTransferId: string | null = null;
  private requestResult: {
    resolve: (payload: FullSharePayload) => void;
    reject: (error: Error) => void;
  } | null = null;

  getStatus(): TransferStatus {
    return { ...this.status };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    this.stopped = false;
    this.token = await deviceTransferStorage.getToken();
    this.status.configured = Boolean(this.token);
    this.emit({ type: "status", ...this.status });
    if (this.token) await this.connect(true);
  }

  async createPairing(): Promise<{ pairCode: string; expiresIn: number }> {
    this.stopped = false;
    this.token = (await deviceTransferStorage.getToken()) ?? null;
    await this.connect(Boolean(this.token));
    const expected = this.token ? "pair.code" : "room.created";
    const result = this.waitFor(expected, () => true, 10000);
    this.send({
      type: this.token ? "pair.create" : "room.create",
      deviceType: deviceType(),
    });
    const event = await result;
    if (event.type === "error")
      throw new Error(event.message || "配对码生成失败");
    if (event.type === "room.created" && typeof event.token === "string") {
      await this.saveToken(event.token);
    }
    return { pairCode: event.pairCode, expiresIn: event.expiresIn };
  }

  async joinPairing(pairCode: string): Promise<void> {
    this.stopped = false;
    this.token = null;
    await this.connect(false);
    const result = this.waitFor(["pair.completed", "error"], () => true, 15000);
    this.send({ type: "pair.join", pairCode, deviceType: deviceType() });
    const event = await result;
    if (event.type === "error") throw new Error(event.message || "配对失败");
    if (typeof event.token !== "string")
      throw new Error("配对响应缺少设备凭据");
    await this.saveToken(event.token);
    this.status.paired = true;
    this.status.peerOnline = true;
    this.emit({ type: "status", ...this.status });
  }

  async requestPeerSessions(): Promise<RemoteSessionSummary[]> {
    await this.ensureAuthenticated();
    if (!this.status.peerOnline) throw new Error("对端当前离线");
    const requestId = crypto.randomUUID();
    const result = this.waitFor(
      ["sessions.list.response", "sessions.list.error"],
      (event) => event.requestId === requestId,
      15000,
    );
    this.send({ type: "sessions.list.request", requestId });
    const event = await result;
    if (event.type === "sessions.list.error") {
      throw new Error(event.reason || "加载对端会话失败");
    }
    if (!Array.isArray(event.sessions)) throw new Error("对端会话列表格式无效");
    return event.sessions.filter(
      (item: unknown): item is RemoteSessionSummary =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as RemoteSessionSummary).id === "string" &&
        typeof (item as RemoteSessionSummary).title === "string" &&
        typeof (item as RemoteSessionSummary).messageCount === "number" &&
        typeof (item as RemoteSessionSummary).lastUpdate === "number",
    );
  }

  respondSessionList(
    requestId: string,
    sessions: RemoteSessionSummary[],
  ): void {
    this.send({
      type: "sessions.list.response",
      requestId,
      sessions: sessions.slice(0, 5),
    });
  }

  async requestSession(sessionId: string): Promise<FullSharePayload> {
    await this.ensureAuthenticated();
    if (!this.status.peerOnline) throw new Error("对端当前离线");
    if (!sessionId) throw new Error("请先选择要传送的会话");
    if (this.requestResult) throw new Error("已有会话请求正在处理");
    const result = new Promise<FullSharePayload>((resolve, reject) => {
      this.requestResult = { resolve, reject };
      setTimeout(
        () => {
          if (!this.requestResult) return;
          this.requestResult.reject(new Error("会话请求超时"));
          this.requestResult = null;
          this.receiveState = null;
          this.send({ type: "transfer.cancel" });
        },
        5 * 60 * 1000,
      );
    });
    this.send({ type: "transfer.request", sessionId });
    return result;
  }

  async sendSnapshot(
    transferId: string,
    payload: FullSharePayload,
  ): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.byteLength > MAX_TRANSFER_BYTES) {
      this.send({ type: "transfer.cancel" });
      throw new Error("会话内容超过 50 MiB 传送上限，请先移除较大的图片或文件");
    }
    const chunks: Uint8Array[] = [];
    for (
      let offset = 0;
      offset < bytes.length;
      offset += TRANSFER_CHUNK_BYTES
    ) {
      chunks.push(bytes.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    let acknowledgedCount = 0;
    this.send({
      type: "transfer.start",
      transferId,
      totalBytes: bytes.byteLength,
      totalChunks: chunks.length,
      sha256,
      title:
        typeof payload.session?.title === "string"
          ? payload.session.title
          : "未命名会话",
      messageCount: payload.messages.length,
    });
    for (let index = 0; index < chunks.length; index += 1) {
      const before = chunks
        .slice(0, index + 1)
        .reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const ack = this.waitFor(
        "transfer.ack",
        (event) =>
          event.transferId === transferId && event.receivedBytes === before,
        30000,
      );
      this.send({
        type: "transfer.chunk",
        transferId,
        index,
        data: encodeBase64(chunks[index]),
      });
      const ackEvent = await ack;
      if (ackEvent.type === "error")
        throw new Error(ackEvent.message || "会话分块确认失败");
      acknowledgedCount += 1;
      this.emit({
        type: "sending-progress",
        sentBytes: before,
        totalBytes: bytes.byteLength,
      });
    }
    if (acknowledgedCount !== chunks.length)
      throw new Error("会话分块传送未完成");
    const sent = this.waitFor("transfer.sent", () => true, 15000);
    this.send({ type: "transfer.finish", transferId });
    const sentEvent = await sent;
    if (sentEvent.type === "error")
      throw new Error(sentEvent.message || "会话发送失败");
  }

  async forgetPair(): Promise<void> {
    await this.ensureAuthenticated();
    const done = this.waitFor("pair.forgotten", () => true, 5000);
    this.send({ type: "pair.forget" });
    await done;
    await deviceTransferStorage.clear();
    this.token = null;
    this.status = {
      configured: false,
      paired: false,
      connected: false,
      peerOnline: false,
      connecting: false,
    };
    this.suppressReconnect = true;
    this.socket?.close();
    this.socket = null;
    this.emit({ type: "status", ...this.status });
  }

  cancelTransfer(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "transfer.cancel" });
    }
  }

  dispose(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private async saveToken(token: string): Promise<void> {
    this.token = token;
    await deviceTransferStorage.setToken(token);
    this.status.configured = true;
    this.status.connected = true;
    this.status.connecting = false;
    this.suppressReconnect = false;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token) throw new Error("尚未配对设备");
    await this.connect(true);
    if (!this.status.connected) {
      await this.waitFor("auth.ok", () => true, 10000);
    }
  }

  private async connect(authenticate: boolean): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (authenticate && this.token && !this.status.connected) {
        const auth = this.waitFor("auth.ok", () => true, 10000);
        this.send({
          type: "auth",
          token: this.token,
          deviceType: deviceType(),
        });
        await auth;
      }
      return;
    }
    if (this.connectingPromise) return this.connectingPromise;
    const connectionPromise = new Promise<void>((resolve, reject) => {
      this.status.connecting = true;
      this.emit({ type: "status", ...this.status });
      const endpoint = new URL("/ws/device-transfer/", window.location.href);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(endpoint.toString());
      this.socket = socket;
      const timeout = setTimeout(() => {
        reject(new Error("连接跨设备服务超时"));
        socket.close();
      }, 10000);
      socket.onopen = () => {
        if (authenticate && this.token) {
          const auth = this.waitFor("auth.ok", () => true, 10000);
          this.send({
            type: "auth",
            token: this.token,
            deviceType: deviceType(),
          });
          auth.then(
            () => {
              clearTimeout(timeout);
              resolve();
            },
            (error) => {
              clearTimeout(timeout);
              reject(error);
            },
          );
        } else {
          clearTimeout(timeout);
          resolve();
        }
      };
      socket.onmessage = (message) => {
        let event: DeviceTransferEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          this.emit({ type: "error", message: "服务端响应格式无效" });
          return;
        }
        void this.handleMessage(event);
      };
      socket.onerror = () => {
        this.emit({ type: "error", message: "跨设备连接失败" });
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        this.status.connected = false;
        this.status.connecting = false;
        this.status.peerOnline = false;
        this.socket = null;
        this.emit({ type: "status", ...this.status });
        for (const waiter of Array.from(this.waiters)) {
          waiter.reject(new Error("跨设备连接已断开"));
        }
        this.requestResult?.reject(new Error("跨设备连接已断开"));
        this.requestResult = null;
        this.receiveState = null;
        if (!this.stopped && !this.suppressReconnect && this.token) {
          this.scheduleReconnect();
        }
      };
    });
    this.connectingPromise = connectionPromise.finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private async handleMessage(event: DeviceTransferEvent): Promise<void> {
    if (event.type === "room.created" && typeof event.token === "string") {
      await this.saveToken(event.token);
    } else if (event.type === "auth.ok") {
      this.status.connected = true;
      this.status.connecting = false;
      this.status.paired = event.paired === true;
      this.status.peerOnline = event.online === true;
      this.reconnectDelay = 1000;
      this.emit({ type: "status", ...this.status });
    } else if (
      event.type === "pair.completed" &&
      typeof event.token === "string"
    ) {
      await this.saveToken(event.token);
      this.status.paired = true;
      this.status.peerOnline = true;
    } else if (event.type === "device.status") {
      this.status.paired = event.paired === true;
      this.status.peerOnline = event.online === true;
      this.emit({ type: "status", ...this.status });
    } else if (event.type === "device.replaced") {
      this.suppressReconnect = true;
      this.socket?.close();
    } else if (event.type === "pair.revoked") {
      await deviceTransferStorage.clear();
      this.token = null;
      this.status = {
        configured: false,
        paired: false,
        connected: false,
        peerOnline: false,
        connecting: false,
      };
      this.suppressReconnect = true;
      this.emit({ type: "status", ...this.status });
      this.socket?.close();
    } else if (event.type === "transfer.waiting") {
      this.activeTransferId = event.transferId;
    } else if (event.type === "transfer.start") {
      this.receiveState = {
        transferId: event.transferId,
        totalBytes: event.totalBytes,
        totalChunks: event.totalChunks,
        sha256: event.sha256,
        chunks: [],
        receivedBytes: 0,
      };
      this.emit(event);
    } else if (event.type === "transfer.chunk") {
      await this.receiveChunk(event);
      return;
    } else if (event.type === "transfer.finish") {
      await this.finishReceiving(event);
      return;
    } else if (
      event.type === "transfer.error" ||
      event.type === "transfer.denied"
    ) {
      this.requestResult?.reject(
        new Error(event.reason || "對端拒絕了會話請求"),
      );
      this.requestResult = null;
      this.receiveState = null;
      this.activeTransferId = null;
    } else if (event.type === "error") {
      this.requestResult?.reject(new Error(event.message || "跨设备操作失败"));
      this.requestResult = null;
      this.receiveState = null;
    }
    this.resolveWaiters(event);
    this.emit(event);
  }

  private async receiveChunk(event: DeviceTransferEvent): Promise<void> {
    const current = this.receiveState;
    if (
      !current ||
      event.transferId !== current.transferId ||
      event.index !== current.chunks.length ||
      typeof event.data !== "string"
    ) {
      this.send({ type: "transfer.cancel" });
      this.requestResult?.reject(new Error("收到的会话数据块顺序无效"));
      this.requestResult = null;
      this.receiveState = null;
      return;
    }
    const chunk = decodeBase64(event.data);
    if (
      chunk.byteLength > TRANSFER_CHUNK_BYTES ||
      current.receivedBytes + chunk.byteLength > current.totalBytes
    ) {
      this.send({ type: "transfer.cancel" });
      this.requestResult?.reject(new Error("收到的会话数据超过声明大小"));
      this.requestResult = null;
      this.receiveState = null;
      return;
    }
    current.chunks.push(chunk);
    current.receivedBytes += chunk.byteLength;
    this.send({
      type: "transfer.ack",
      receivedBytes: current.receivedBytes,
    });
    this.emit({
      type: "receiving-progress",
      receivedBytes: current.receivedBytes,
      totalBytes: current.totalBytes,
    });
  }

  private async finishReceiving(event: DeviceTransferEvent): Promise<void> {
    const current = this.receiveState;
    if (
      !current ||
      event.transferId !== current.transferId ||
      current.receivedBytes !== current.totalBytes ||
      current.chunks.length !== current.totalChunks
    ) {
      this.requestResult?.reject(new Error("会话快照传输不完整"));
      this.requestResult = null;
      this.receiveState = null;
      this.send({ type: "transfer.cancel" });
      return;
    }
    const bytes = new Uint8Array(current.totalBytes);
    let offset = 0;
    for (const chunk of current.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (sha256 !== current.sha256 || event.sha256 !== current.sha256) {
      this.requestResult?.reject(new Error("会话快照校验失败，请重新传送"));
      this.requestResult = null;
      this.receiveState = null;
      this.send({ type: "transfer.cancel" });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      this.requestResult?.reject(new Error("会话快照内容无法解析"));
      this.requestResult = null;
      this.receiveState = null;
      this.send({ type: "transfer.cancel" });
      return;
    }
    if (!isFullSharePayload(payload)) {
      this.requestResult?.reject(new Error("会话快照版本或结构无效"));
      this.requestResult = null;
      this.receiveState = null;
      this.send({ type: "transfer.cancel" });
      return;
    }
    this.requestResult?.resolve(payload);
    this.requestResult = null;
    this.receiveState = null;
    this.activeTransferId = null;
    this.emit({
      type: "transfer.ready",
      payload,
      title:
        typeof payload.session.title === "string"
          ? payload.session.title
          : "未命名会话",
      messageCount: payload.messages.length,
    });
  }

  private waitFor(
    type: string | string[],
    predicate: (event: DeviceTransferEvent) => boolean,
    timeoutMs: number,
  ): Promise<DeviceTransferEvent> {
    return new Promise((resolve, reject) => {
      const waiter: EventWaiter = {
        type,
        predicate,
        resolve: (event) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(event);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(new Error(`等待 ${type} 响应超时`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private resolveWaiters(event: DeviceTransferEvent): void {
    for (const waiter of this.waiters) {
      if (event.type === "error") {
        waiter.resolve(event);
        continue;
      }
      if (
        waiter.type !== event.type &&
        !(Array.isArray(waiter.type) && waiter.type.includes(event.type))
      )
        continue;
      if (waiter.predicate(event)) waiter.resolve(event);
    }
  }

  private send(value: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("跨设备服务连接已断开");
    }
    this.socket.send(JSON.stringify(value));
  }

  private emit(event: DeviceTransferEvent): void {
    this.resolveWaiters(event);
    for (const listener of this.listeners) listener(event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token && !this.stopped && !this.suppressReconnect) {
        void this.connect(true).catch(() => this.scheduleReconnect());
      }
    }, delay);
  }
}

export const deviceTransferClient = new DeviceTransferClient();
