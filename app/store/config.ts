import { LLMModel } from "../client/api";
import { StoreKey } from "../constant";
import { createPersistStore, jchatStorage } from "../utils/store";
import { useAccessStore } from "./access";

export type ModelType = string; // 改为更灵活的类型定义

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // timestamp, to merge state

  fontSize: 14.5,
  fontFamily: "",
  theme: Theme.Auto as Theme,

  enableCodeFold: true, // code fold config

  models: [{ name: "google/gemini-2.5-flash" }],

  modelConfig: {
    model: "" as ModelType, // 默认模型将由服务器端配置决定
    temperature: 0.5,
    max_tokens: 8000,
    budget_tokens: 4000,
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;
export type ModelConfig = ChatConfig["modelConfig"];

export function limitNumber(
  x: number,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (isNaN(x)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x));
}

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
  max_tokens(x: number) {
    return limitNumber(x, 0, 1000000, 1024);
  },
  budget_tokens(x: number) {
    return limitNumber(x, 0, 64000, 1024);
  },
  temperature(x: number) {
    return limitNumber(x, 0, 2, 1);
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      set(() => ({ ...DEFAULT_CONFIG }));
    },

    mergeModels(newModels: LLMModel[]) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      // 只用 accessStore.customModels 判断
      const accessStore = useAccessStore.getState();
      if (
        accessStore.customModels &&
        accessStore.customModels.trim().length > 0
      ) {
        set(() => ({ models: newModels }));
      } else {
        // 没有服务器端模型时合并默认模型
        const oldModels = get().models;
        const modelMap: Record<string, LLMModel> = {};
        for (const model of oldModels) {
          modelMap[`${model.name}`] = model;
        }
        for (const model of newModels) {
          modelMap[`${model.name}`] = model;
        }
        set(() => ({ models: Object.values(modelMap) }));
      }
    },
  }),
  {
    name: StoreKey.Config,
    version: 3.2,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      // 简化 migrate 函数，只做版本兼容性处理
      // 数据迁移改为在应用启动时主动执行，使用 app/utils/migration.ts 并在 app/components/home.tsx 中调用
      return persistedState as any;
    },
  },
);
