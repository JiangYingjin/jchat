import { ChatMessage } from "@/app/store";

export function findMessagePairForResend(
  messages: ChatMessage[],
  targetMessageId: string,
) {
  const resendingIndex = messages.findIndex((m) => m.id === targetMessageId);
  if (resendingIndex < 0)
    return { userMessage: undefined, botMessage: undefined, requestIndex: -1 };

  let userMessage: ChatMessage | undefined;
  let botMessage: ChatMessage | undefined;
  let requestIndex = resendingIndex;
  const message = messages[resendingIndex];

  if (message.role === "assistant") {
    botMessage = message;
    for (let i = resendingIndex; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        userMessage = messages[i];
        requestIndex = i;
        break;
      }
    }
  } else if (message.role === "user") {
    userMessage = message;
    for (let i = resendingIndex; i < messages.length; i += 1) {
      if (messages[i].role === "assistant") {
        botMessage = messages[i];
        break;
      }
    }
  }
  return { userMessage, botMessage, requestIndex };
}
