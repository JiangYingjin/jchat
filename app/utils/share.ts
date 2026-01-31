/**
 * 分享链接相关工具：Base58 6 位 id 生成、分享 payload 构建等
 */

import type { MessageRole } from "../client/api";
import type { MultimodalContent } from "../client/api";
import { buildSystemContentForShare, convertImageUrlsToBase64 } from "./chat";

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
