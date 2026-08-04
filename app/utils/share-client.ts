"use client";

/**
 * 客户端专用分享函数：依赖浏览器 API（fetch、剪贴板），
 * 与 utils/share.ts（可被服务端 App Route 导入）分离，避免服务端构建边界错误。
 */

import { getHeaders } from "../client/api";
import { copyToClipboard } from "../utils";
import { buildFullSharePayload, type SessionLikeForShare } from "./share";

export type { SessionLikeForShare } from "./share";

/** 分享结果：链接与分享 id */
export interface ShareSessionResult {
  link: string;
  shareId: string;
}

/**
 * 将会话分享为链接（复用 buildFullSharePayload + POST /api/share + 复制到剪贴板）
 * 返回 { link, shareId }；失败抛出 Error（含服务端 msg）。
 * displayMessageIds 为空或 undefined 时分享全部消息。
 */
export async function shareSessionAsLink(
  session: SessionLikeForShare & Record<string, unknown>,
  systemMessageData: { text: string; images: string[] } | null,
  displayMessageIds?: string[],
): Promise<ShareSessionResult | null> {
  const payload = await buildFullSharePayload(session, systemMessageData);
  const res = await fetch("/api/share", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      ...payload,
      ...(displayMessageIds != null && displayMessageIds.length > 0
        ? { displayMessageIds }
        : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.msg || "分享失败");
  }
  if (data.link && data.shareId) {
    await copyToClipboard(data.link);
    return data;
  }
  return null;
}
