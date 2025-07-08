import { LLMModel } from "../client/api";
import { StoreKey } from "../constant";
import { createPersistStore, jchatStorage } from "../utils/store";
import { useAccessStore } from "./access";

export type ModelType = string; // 改为更灵活的类型定义

export const DEFAULT_CONFIG = {
  modelConfig: {
    model: "" as ModelType, // 默认模型将由服务器端配置决定
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;
export type ModelConfig = ChatConfig["modelConfig"];

// 移除了未被使用的 limitNumber 函数

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      set(() => ({ ...DEFAULT_CONFIG }));
    },

    // 移除了 mergeModels 方法（该方法无实际逻辑）
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
