import { LLMModel } from "../client/api";
import { getClientConfig } from "../config/client";
import { DEFAULT_INPUT_TEMPLATE, DEFAULT_MODELS, StoreKey } from "../constant";
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

  fontSize: 14,
  fontFamily: "",
  theme: Theme.Auto as Theme,

  enableCodeFold: true, // code fold config

  customModels: "",
  models: DEFAULT_MODELS as any as LLMModel[],

  modelConfig: {
    model: "gpt-4o-mini" as ModelType,
    providerName: "OpenAI",
    temperature: 0.5,
    max_tokens: 1000000,
    budget_tokens: 4000,
    compressModel: "",
    compressProviderName: "",
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
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
        model.available = false;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      for (const model of newModels) {
        model.available = true;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
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
    async migrate(persistedState: any, version: number) {
      console.log("[ConfigStore] 开始数据迁移，版本:", version);

      // 如果没有持久化状态，或者版本已经是最新的，直接返回
      if (!persistedState || version >= 3.2) {
        const state = persistedState as ChatConfig;
        return state as any;
      }

      // 尝试从旧的存储键中迁移数据
      try {
        const oldKey = "app-config";
        const oldData = await jchatStorage.getItem(oldKey);

        if (oldData && !persistedState) {
          console.log("[ConfigStore] 发现旧数据，正在迁移...");

          // 将旧数据复制到新的存储键下
          await jchatStorage.setItem(StoreKey.Config, oldData);

          console.log(
            "[ConfigStore] 数据迁移成功，从",
            oldKey,
            "迁移到",
            StoreKey.Config,
          );

          // 保留原始数据不删除，按用户要求
          console.log("[ConfigStore] 保留原始数据");

          return oldData as any;
        }
      } catch (error) {
        console.error("[ConfigStore] 数据迁移失败:", error);
      }

      const state = persistedState as ChatConfig;
      return state as any;
    },
  },
);
