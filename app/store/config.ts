import { LLMModel } from "../client/api";
import { getClientConfig } from "../config/client";
import { DEFAULT_INPUT_TEMPLATE, DEFAULT_MODELS, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";

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
  tightBorder: true,
  // tightBorder: !!config?.isApp,
  sendPreviewBubble: false,
  enableAutoGenerateTitle: true,
  // sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarWidth: 180,

  enableArtifacts: true, // show artifacts config

  enableCodeFold: true, // code fold config

  disablePromptHint: true,

  dontShowMaskSplashScreen: true, // dont show splash screen when create chat

  customModels: "",
  models: DEFAULT_MODELS as any as LLMModel[],

  modelConfig: {
    model: "gpt-4o-mini" as ModelType,
    providerName: "OpenAI",
    temperature: 0.5,
    max_tokens: 1000000,
    budget_tokens: 4000,
    sendMemory: false,
    compressModel: "",
    compressProviderName: "",
    enableInjectSystemPrompts: false,
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
    version: 3.9,
    migrate(persistedState, version) {
      const state = persistedState as ChatConfig;
      return state as any;
    },
  },
);
