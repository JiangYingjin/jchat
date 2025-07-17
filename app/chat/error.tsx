"use client";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h2>聊天页面出错了!</h2>
      <button onClick={reset}>重试</button>
    </div>
  );
}
