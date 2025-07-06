import Image from "next/image";
import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { ModelType } from "../store";

import BotIcon from "../icons/bot.svg";
import BlackBotIcon from "../icons/black-bot.svg";

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  return `https://cdnjs.cloudflare.com/ajax/libs/emoji-datasource-apple/15.0.1/img/${style}/64/${unified}.png`;
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <div
      style={{
        width: props.size || 30,
        height: props.size || 30,
        borderRadius: "50%",
        backgroundColor: "#f0f0f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: (props.size || 30) * 0.6,
      }}
    >
      {props.avatar === "gpt-bot" ? "🤖" : props.avatar}
    </div>
  );
}

export function Avatar(props: {
  avatar?: string;
  model?: ModelType;
  size?: number;
}) {
  if (props.avatar && props.avatar !== "gpt-bot") {
    return <EmojiAvatar avatar={props.avatar} size={props.size} />;
  }

  return (
    <div
      style={{
        width: props.size || 30,
        height: props.size || 30,
        borderRadius: "50%",
        backgroundColor: "#f0f0f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {props.model?.includes("gpt-4") ? (
        <BlackBotIcon width={props.size || 30} height={props.size || 30} />
      ) : (
        <BotIcon width={props.size || 30} height={props.size || 30} />
      )}
    </div>
  );
}

export function AvatarPicker(props: { onEmojiClick: (emoji: string) => void }) {
  return (
    <EmojiPicker
      theme={EmojiTheme.AUTO}
      onEmojiClick={(e) => props.onEmojiClick(e.unified)}
    />
  );
}
