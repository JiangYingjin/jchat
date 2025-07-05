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
