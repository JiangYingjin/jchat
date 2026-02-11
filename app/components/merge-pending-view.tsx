"use client";

import React, { useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import { useChatStore } from "../store";
import Locale from "../locales";
import { aggregateSessionMetrics } from "../utils/session";
import { formatCost, formatTime, formatTps } from "../utils/metrics";
import { showToast } from "./ui-lib";
import chatItemStyles from "../styles/chat-item.module.scss";

function MergeOrderItem({
  sessionId,
  index,
}: {
  sessionId: string;
  index: number;
}) {
  const session = useChatStore(
    (state) => state.sessions.find((s) => s.id === sessionId) ?? null,
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sessionId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const metrics = useMemo(() => {
    if (!session?.messages?.length) return null;
    return aggregateSessionMetrics(session, { includeStreaming: false });
  }, [session?.id, session?.messages?.length]);

  const statsLine = useMemo(() => {
    if (!metrics) return null;
    const inTokens = metrics.totalPromptTokens || 0;
    const outTokens = metrics.totalCompletionTokens || 0;
    const tokensStr =
      inTokens + outTokens > 0 ? `${inTokens}/${outTokens}` : "";
    const costStr =
      metrics.totalCost > 0 ? `￥${formatCost(metrics.totalCost)}` : "";
    const ttftStr =
      typeof metrics.avgTtft === "number"
        ? `${formatTime(metrics.avgTtft)}s`
        : "";
    const totalStr =
      typeof metrics.avgTotalTime === "number"
        ? `${formatTime(metrics.avgTotalTime)}s`
        : "";
    const tpsStr =
      typeof metrics.weightedTps === "number"
        ? formatTps(metrics.weightedTps)
        : "";
    const parts: string[] = [];
    if (costStr) parts.push(costStr);
    if (tokensStr) parts.push(tokensStr);
    const timePieces = [ttftStr, totalStr].filter(Boolean);
    let timePart = timePieces.join("/");
    if (timePart) {
      timePart = tpsStr ? `${timePart} (${tpsStr})` : timePart;
      parts.push(timePart);
    } else if (tpsStr) parts.push(`(${tpsStr})`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [metrics]);

  if (!session) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        chatItemStyles["chat-item"] +
        " " +
        chatItemStyles["chat-item-merge"] +
        " flex flex-col gap-1 py-2"
      }
      {...attributes}
      {...listeners}
    >
      <div className="font-medium">{session.title}</div>
      <div className="text-xs text-gray-500 flex flex-wrap gap-x-3">
        <span>
          {Locale.Chat.Merge.MessagesCount(session.messageCount ?? 0)}
        </span>
        {statsLine && <span>{statsLine}</span>}
      </div>
    </div>
  );
}

export function MergePendingView() {
  const chatStore = useChatStore();
  const mergeOrderSessionIds = useChatStore(
    (state) => state.mergeOrderSessionIds,
  );
  const exitMergeMode = useChatStore((state) => state.exitMergeMode);
  const mergeSessionsAndCreateNew = useChatStore(
    (state) => state.mergeSessionsAndCreateNew,
  );
  const reorderMergeOrder = useChatStore((state) => state.reorderMergeOrder);
  const sessions = useChatStore((state) => state.sessions);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 进入待合并界面时加载各会话消息，以便展示 token 统计
  useEffect(() => {
    for (const id of mergeOrderSessionIds) {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        useChatStore.getState().loadSessionMessages(idx);
      }
    }
  }, [mergeOrderSessionIds.join(","), sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (active.id !== over?.id) {
        const fromIndex = mergeOrderSessionIds.indexOf(active.id as string);
        const toIndex = mergeOrderSessionIds.indexOf(over?.id as string);
        if (fromIndex !== -1 && toIndex !== -1) {
          reorderMergeOrder(fromIndex, toIndex);
        }
      }
    },
    [mergeOrderSessionIds, reorderMergeOrder],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitMergeMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitMergeMode]);

  const handleConfirm = async () => {
    try {
      await mergeSessionsAndCreateNew();
      showToast(Locale.Chat.Actions.TitleGenerated);
    } catch (err) {
      console.error("[MergePendingView] 合并失败", err);
      showToast("合并失败，请重试");
    }
  };

  if (mergeOrderSessionIds.length < 2) return null;

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <h2 className="text-lg font-semibold mb-1">{Locale.Chat.Merge.Title}</h2>
      <p className="text-sm text-gray-500 mb-4">{Locale.Chat.Merge.Hint}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext
          items={mergeOrderSessionIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 flex-1 overflow-auto">
            {mergeOrderSessionIds.map((id, i) => (
              <MergeOrderItem key={id} sessionId={id} index={i} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-primary text-white hover:opacity-90"
          onClick={handleConfirm}
        >
          {Locale.Chat.Merge.Confirm}
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={exitMergeMode}
        >
          {Locale.Chat.Merge.Cancel}
        </button>
      </div>
    </div>
  );
}
