import cn from "./cn";
import type { LocaleType } from "./cn";
export type { LocaleType, PartialLocaleType } from "./cn";

// 移除多语言选择，始终使用简体中文
export type Lang = "cn";

export const AllLangs = ["cn"] as const;

export const ALL_LANG_OPTIONS = {
  cn: "简体中文",
} as const;

// 直接导出中文语言包
export default cn as LocaleType;

// 简化的语言获取函数，始终返回中文
export function getLang(): Lang {
  return "cn";
}

// 移除语言切换功能
export function changeLang(lang: Lang) {
  // 语言切换功能已移除，始终使用中文
  console.log("Language switching has been disabled, always using Chinese");
}

// 始终返回中文的ISO代码
export function getISOLang() {
  return "zh-Hans";
}
