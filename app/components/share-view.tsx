"use client";

import React from "react";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import type { ChatMessage } from "../store";
import type { MultimodalContent } from "../client/api";
import styles from "../styles/chat.module.scss";
import LoadingIcon from "../icons/three-dots.svg";
import Locale from "../locales";

export interface ShareMessage {
  role: "system" | "user" | "assistant";
  content: string | MultimodalContent[];
  model?: string;
  date?: string;
}

/** 将 API 返回的 messages 规范为 MessageList 所需的 ChatMessage 形状 */
function normalizeShareMessages(
  raw: ShareMessage[],
): (ChatMessage & { preview?: boolean })[] {
  return raw.map((msg, i) => ({
    id: `share-${i}`,
    role: msg.role,
    content: msg.content,
    model: msg.model?.trim() || undefined,
    date: msg.date ?? "",
  }));
}

/** 分享页只读视图：复用 ChatHeader + MessageList，与 Chat 相同布局，无侧边栏/输入/操作 */
export function ShareView({
  title,
  messages,
}: {
  title?: string;
  messages: ShareMessage[];
}) {
  const normalized = React.useMemo(
    () => normalizeShareMessages(messages),
    [messages],
  );
  const [autoScroll, setAutoScroll] = React.useState(true);
  const setHitBottom = React.useCallback(() => {}, []);

  const noop = React.useCallback(() => {}, []);

  return (
    <div className={styles.chat}>
      <ChatHeader
        sessionTitle={title?.trim() || "分享的对话"}
        messageCount={normalized.length}
        readOnly
      />
      <div className={styles["chat-main"]}>
        <div className={styles["chat-body-container"]}>
          <MessageList
            messages={normalized}
            onResend={noop}
            onDelete={noop}
            onUserStop={noop}
            onBranch={noop}
            onBatchApply={noop}
            onBatchDelete={noop}
            onEditMessage={noop}
            handleTripleClick={noop}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            setHitBottom={setHitBottom}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}

export function SharePageClient({ shareId }: { shareId: string }) {
  const [data, setData] = React.useState<{
    title?: string;
    messages: ShareMessage[];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/share/${shareId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("分享不存在或已失效");
          throw new Error(res.statusText);
        }
        return res.json();
      })
      .then((body) => {
        if (!cancelled && Array.isArray(body.messages)) {
          const title =
            typeof body.version === "number" &&
            body.session &&
            typeof body.session === "object" &&
            "title" in body.session
              ? (body.session as { title?: string }).title
              : body.title;
          // 若有 displayMessageIds 则仅展示勾选的消息，否则展示全部
          const displayIds = Array.isArray(body.displayMessageIds)
            ? body.displayMessageIds
            : null;
          const messages =
            displayIds != null && displayIds.length > 0
              ? body.messages.filter(
                  (m: ShareMessage & { id?: string }) =>
                    m.id != null && displayIds.includes(m.id),
                )
              : body.messages;
          setData({ title, messages });
        } else {
          setError("数据格式异常");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : Locale.Export.ShareFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (loading) {
    return (
      <div
        className={styles["chat-main"]}
        style={{ padding: "2rem", textAlign: "center" }}
      >
        <LoadingIcon />
        <span style={{ marginLeft: "8px" }}>加载中…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className={styles["chat-main"]}
        style={{ padding: "2rem", textAlign: "center" }}
      >
        {error}
      </div>
    );
  }
  if (!data) return null;
  return <ShareView title={data.title} messages={data.messages} />;
}
