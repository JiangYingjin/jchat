"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import sidebarStyles from "../styles/sidebar.module.scss";

export interface ContextMenuHook {
  openAtEvent: (e: React.MouseEvent) => void;
  close: () => void;
  isOpen: boolean;
  render: (content: React.ReactNode) => React.ReactNode;
}

export function useContextMenu(): ContextMenuHook {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openAtEvent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 160; // 与样式匹配的预估宽度（min-width 最终可能更小）
    const menuHeight = 80; // 预估高度
    const padding = 8;

    const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - padding);

    setPos({ x: Math.max(padding, x), y: Math.max(padding, y) });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalClose = (ev: Event) => {
      const target = ev.target as Element | null;
      if (
        target &&
        target.closest(`.${sidebarStyles["search-context-menu"]}`)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setIsOpen(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleGlobalClose, true);
      document.addEventListener("scroll", handleGlobalClose, true);
      document.addEventListener("keydown", handleKey, true);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleGlobalClose, true);
      document.removeEventListener("scroll", handleGlobalClose, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [isOpen]);

  const render = useCallback(
    (content: React.ReactNode) => {
      if (!isOpen || typeof window === "undefined") return null;
      return createPortal(
        <div
          className={sidebarStyles["search-context-menu"]}
          style={{ left: pos.x, top: pos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>,
        document.body,
      );
    },
    [isOpen, pos.x, pos.y],
  );

  return useMemo(
    () => ({ openAtEvent, close, isOpen, render }),
    [openAtEvent, close, isOpen, render],
  );
}
