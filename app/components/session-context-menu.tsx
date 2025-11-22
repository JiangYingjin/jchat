"use client";

import React from "react";
import { useChatStore, type ChatSession } from "../store";
import { type ContextMenuHook } from "./context-menu";
import { showToast, showConfirm } from "./ui-lib";
import Locale from "../locales";
import sidebarStyles from "../styles/sidebar.module.scss";

export interface SessionContextMenuProps {
  sessionId: string;
  session?: ChatSession; // 可选，如果提供则不需要通过 ID 查找
  showMoveToTop?: boolean; // 是否显示"移至顶部"选项
  sessionIndex?: number; // 用于移至顶部功能
  enableInlineEdit?: boolean; // 是否支持内联编辑（ChatHeader 不支持）
  onUpdateTitle?: () => void; // 更新标题回调（用于内联编辑）
  onEditSession?: () => void; // 编辑会话回调（用于打开 SessionEditor）
  menu: ContextMenuHook; // 从 useContextMenu 获取的 hook
  onClose?: () => void; // 菜单关闭回调
}

export function SessionContextMenu(props: SessionContextMenuProps) {
  const chatStore = useChatStore();
  const moveSession = useChatStore((state) => state.moveSession);

  // 获取会话对象
  const session = props.session || chatStore.getSessionById(props.sessionId);

  // 如果会话不存在，不渲染菜单
  if (!session) {
    return null;
  }

  // 处理移至顶部
  const handleMoveToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.sessionIndex !== undefined && props.sessionIndex !== 0) {
      moveSession(props.sessionIndex, 0);
      showToast(`会话 "${session.title}" 已移至顶部`);
    }
    props.menu.close();
    props.onClose?.();
  };

  // 处理更新标题
  const handleUpdateTitle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.enableInlineEdit && props.onUpdateTitle) {
      // 内联编辑模式（ChatItem）
      props.onUpdateTitle();
    } else if (props.onEditSession) {
      // 打开 SessionEditor（ChatHeader）
      props.onEditSession();
    }
    props.menu.close();
    props.onClose?.();
  };

  // 处理生成标题
  const handleGenerateTitle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      showToast("会话不存在");
      props.menu.close();
      props.onClose?.();
      return;
    }

    // 检查是否手动编辑过标题
    if (session.isTitleManuallyEdited) {
      const confirmed = await showConfirm(
        <div style={{ padding: "8px 16px" }}>
          <p style={{ fontSize: "14px", marginBottom: "12px" }}>
            当前标题 &quot;<strong>{session.title}</strong>&quot;
            是您手动编辑的。
          </p>
          <p style={{ fontSize: "14px", color: "#666" }}>
            生成新标题将覆盖您手动编辑的标题，是否继续？
          </p>
        </div>,
      );

      if (!confirmed) {
        props.menu.close();
        props.onClose?.();
        return;
      }
    }

    // 生成标题
    showToast(Locale.Chat.Actions.GeneratingTitle);
    try {
      await chatStore.generateSessionTitle(true, session);
      // showToast(Locale.Chat.Actions.TitleGenerated);
    } catch (error) {
      console.error("生成标题失败:", error);
      showToast("生成标题失败，请重试");
    }

    props.menu.close();
    props.onClose?.();
  };

  return props.menu.render(
    <>
      {/* 移至顶部 - 仅在 showMoveToTop 为 true 且 sessionIndex 有效时显示 */}
      {props.showMoveToTop && props.sessionIndex !== undefined && (
        <div
          className={sidebarStyles["search-context-item"]}
          onClick={handleMoveToTop}
        >
          移至顶部
        </div>
      )}

      {/* 更新标题 */}
      <div
        className={sidebarStyles["search-context-item"]}
        onClick={handleUpdateTitle}
      >
        {Locale.Chat.Actions.UpdateTitle}
      </div>

      {/* 生成标题 */}
      <div
        className={sidebarStyles["search-context-item"]}
        onClick={handleGenerateTitle}
      >
        {Locale.Chat.Actions.GenerateTitle}
      </div>
    </>,
  );
}
