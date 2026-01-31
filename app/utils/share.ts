/**
 * 分享链接相关工具：Base58 6 位 id 生成、分享 payload 构建等
 * 全量分享采用版本化 payload，便于后续扩展新字段（未知字段透传存储/载入）。
 */

import type { MessageRole } from "../client/api";
import type { MultimodalContent } from "../client/api";
import { buildSystemContentForShare, convertImageUrlsToBase64 } from "./chat";

/** 当前全量分享 payload 版本，用于兼容与迁移 */
export const SHARE_PAYLOAD_VERSION = 1;

export interface SharePayloadMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
  model?: string;
  date?: string;
}

export interface SharePayload {
  title?: string;
  messages: SharePayloadMessage[];
}

/** 全量分享：会话元数据。仅排除 messages/scrollState，其余字段透传以支持未来新属性 */
export type ShareSessionMeta = Record<string, unknown>;

/** 全量分享：系统提示词 */
export interface ShareSystemPrompt {
  text: string;
  images: string[];
}

/** 全量分享单条消息：已知字段 + 未知字段透传 */
export interface FullSharePayloadMessage extends SharePayloadMessage {
  id?: string;
  [key: string]: unknown;
}

/** 全量分享 payload：版本化，便于载入时做兼容处理 */
export interface FullSharePayload {
  version: number;
  session: ShareSessionMeta;
  systemPrompt: ShareSystemPrompt | null;
  messages: FullSharePayloadMessage[];
}

/**
 * 根据选中的消息和系统提示词构建分享 payload（图片转 base64，单图失败则跳过）
 */
export async function buildSharePayload(
  selectedMessages: Array<{
    id: string;
    role: MessageRole;
    content: string | MultimodalContent[];
    model?: string;
    date?: string;
  }>,
  sessionTitle: string,
  sessionId: string,
  systemMessageData: { text: string; images: string[] } | null,
): Promise<SharePayload> {
  const messages: SharePayloadMessage[] = [];
  const systemId = `system-${sessionId}`;

  for (const msg of selectedMessages) {
    const content =
      msg.id === systemId && systemMessageData
        ? await buildSystemContentForShare(systemMessageData)
        : await convertImageUrlsToBase64(msg.content);
    const date =
      typeof msg.date === "string"
        ? msg.date
        : msg.date
          ? ((msg.date as Date).toISOString?.() ?? "")
          : undefined;
    messages.push({
      role: msg.role,
      content,
      model: msg.model?.trim() || undefined,
      date: date || undefined,
    });
  }

  return {
    title: sessionTitle.trim() || undefined,
    messages,
  };
}

/**
 * 从会话中提取元数据（排除 messages、scrollState），用于全量分享；其余字段透传以支持未来新属性
 */
function toShareSessionMeta(session: {
  messages?: unknown;
  scrollState?: unknown;
  [key: string]: unknown;
}): ShareSessionMeta {
  const { messages: _m, scrollState: _s, ...rest } = session;
  return { ...rest };
}

/** 全量分享可接受的会话形状：与 ChatSession 兼容，便于扩展新字段 */
export type SessionLikeForShare = {
  messages: Array<{
    id?: string;
    role: MessageRole;
    content: string | MultimodalContent[];
    model?: string;
    date?: string | Date;
  }>;
  scrollState?: unknown;
};

/**
 * 构建全量分享 payload：会话元数据 + 系统提示词 + 全量消息（图片转 base64，单图失败则跳过）
 * 消息除 content/date 做序列化外，其余字段原样透传，便于扩展
 */
export async function buildFullSharePayload(
  session: SessionLikeForShare & Record<string, unknown>,
  systemMessageData: { text: string; images: string[] } | null,
): Promise<FullSharePayload> {
  const sessionMeta = toShareSessionMeta(session);
  const systemPrompt: ShareSystemPrompt | null = systemMessageData
    ? {
        text: systemMessageData.text,
        images: [...systemMessageData.images],
      }
    : null;

  const messages: FullSharePayloadMessage[] = [];
  for (const msg of session.messages) {
    const content = await convertImageUrlsToBase64(msg.content);
    const date =
      typeof msg.date === "string"
        ? msg.date
        : ((msg.date as Date)?.toISOString?.() ?? "");
    const { content: _c, date: _d, ...rest } = msg;
    messages.push({ ...rest, content, date });
  }

  return {
    version: SHARE_PAYLOAD_VERSION,
    session: sessionMeta,
    systemPrompt,
    messages,
  };
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_LEN = 58;
const SHARE_ID_LENGTH = 6;
const MAX_B58_6 = BASE58_LEN ** SHARE_ID_LENGTH; // 58^6

/**
 * 生成 6 位 Base58 编码的分享 id（无 0/O/I/l，避免歧义）
 */
export function generateShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let n = 0;
  for (let i = 0; i < 4; i++) n = (n << 8) | bytes[i];
  n = n >>> 0; // unsigned 32-bit
  n = n % MAX_B58_6;

  let s = "";
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    s = BASE58_ALPHABET[n % BASE58_LEN] + s;
    n = Math.floor(n / BASE58_LEN);
  }
  return s;
}

/** 校验 shareId 格式：仅允许 6 位 Base58 字符 */
export function isValidShareId(id: string): boolean {
  if (id.length !== SHARE_ID_LENGTH) return false;
  for (let i = 0; i < id.length; i++) {
    if (!BASE58_ALPHABET.includes(id[i])) return false;
  }
  return true;
}

/** 从文本中解析分享链接并提取 shareId（如 https://chat.jyj.cx/s/4XLdBp 或 /s/4XLdBp），无效则返回 null */
export function parseShareLink(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/\/s\/([1-9A-HJ-NP-Za-km-z]{6})/);
  const id = match?.[1] ?? null;
  return id && isValidShareId(id) ? id : null;
}
