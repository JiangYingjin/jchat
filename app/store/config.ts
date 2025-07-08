import { StoreKey } from "../constant";
import { createPersistStore, jchatStorage } from "../utils/store";

export const DEFAULT_CONFIG = {
  modelConfig: {
    model: "" as string, // 默认模型将由服务器端配置决定
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;
export type ModelConfig = ChatConfig["modelConfig"];

export const ModalConfigValidator = {
  model(x: string) {
    return x as string;
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({}),
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
