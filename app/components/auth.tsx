"use client";

import styles from "../styles/auth.module.scss";
import { IconButton } from "./button";
import { useRef, useEffect } from "react";

import { useRouter } from "next/navigation";
import { Path } from "../constant";
import { useChatStore } from "../store";
import Locale from "../locales";
import { checkAccessCodeSync } from "../utils/auth";

import BotIcon from "../icons/bot.svg";

export function AuthPage() {
  const router = useRouter();
  const chatStore = useChatStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // 页面加载后自动聚焦到输入框
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const goChat = async () => {
    // 同步检查当前 accessCode 是否有权限
    const currentAccessCode = chatStore.accessCode;
    if (!currentAccessCode) {
      // 如果 accessCode 为空，不做任何操作，停留在 auth 页面
      return;
    }

    const hasPermission = await checkAccessCodeSync(currentAccessCode);
    if (hasPermission) {
      // 有权限，跳转到首页
      router.push(Path.Home);
    }
    // 如果没有权限，不更新 chatStore.accessCode，也不离开 auth 页面
  };

  return (
    <div className={styles["auth-page"]}>
      <div className={`no-dark ${styles["auth-logo"]}`}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>{Locale.Auth.Title}</div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

      <input
        ref={inputRef}
        className={styles["auth-input"]}
        type="password"
        placeholder={Locale.Auth.Input}
        value={chatStore.accessCode}
        onChange={(e) => {
          chatStore.update((chat) => (chat.accessCode = e.currentTarget.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "Enter" && e.ctrlKey)) {
            e.preventDefault();
            goChat();
          }
        }}
      />

      <div className={styles["auth-actions"]}>
        <IconButton
          text={Locale.Auth.Confirm}
          type="primary"
          onClick={goChat}
        />
      </div>
    </div>
  );
}
