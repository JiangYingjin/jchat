import { StoreKey } from "../constant";
import { createPersistStore, jchatStorage } from "../utils/store";

const DEFAULT_ACCESS_STATE = {};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },
  (set, get) => ({}),
  {
    name: StoreKey.Access,
    version: 8.0,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      // 版本 8.0: 移除 models 属性（已迁移到 useChatStore）
      if (version < 8.0) {
        if (persistedState.models !== undefined) {
          delete persistedState.models;
        }
      }
      return persistedState as any;
    },
  },
);
