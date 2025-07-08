import { LLMModel } from "../client/api";
import { getClientConfig } from "../config/client";
import { DEFAULT_MODELS, StoreKey } from "../constant";
import { createPersistStore, jchatStorage } from "../utils/store";

export type ModelType = (typeof DEFAULT_MODELS)[number]["name"];

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

const config = getClientConfig();

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // timestamp, to merge state

  fontSize: 14.5,
  fontFamily: "",
  theme: Theme.Auto as Theme,

  enableCodeFold: true, // code fold config

  customModels: "",
  models: DEFAULT_MODELS as any as LLMModel[],

  modelConfig: {
    model: "gpt-4.1-mini" as ModelType,
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
    return limitNumber(x, 0, 512000, 1024);
  },
  budget_tokens(x: number) {
    return limitNumber(x, 0, 32000, 1024);
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

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};

      for (const model of oldModels) {
        modelMap[`${model.name}`] = model;
      }

      for (const model of newModels) {
        modelMap[`${model.name}`] = model;
      }

      set(() => ({
        models: Object.values(modelMap),
      }));
    },

    allModels() {},
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
