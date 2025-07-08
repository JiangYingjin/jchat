import { StoreKey, ApiPath, OPENAI_BASE_URL } from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore, jchatStorage } from "../utils/store";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const DEFAULT_OPENAI_URL = ApiPath.OpenAI; // 始终使用代理

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  // server config
  customModels: "",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },
  (set, get) => ({
    enabledAccessControl() {
      this.fetch();
      // 直接返回 true，始终需要访问码
      return true;
    },
    isAuthorized() {
      this.fetch();
      // 只要 enabledAccessControl 恒为 true，这里逻辑也可简化
      return false;
    },
    fetch() {
      if (fetchState > 0 || !getClientConfig()) return;
      fetchState = 1;
      fetch("/api/config", {
        method: "post",
        body: null,
        headers: {
          ...getHeaders(),
        },
      })
        .then((res) => res.json())
        .then((res: any) => {
          console.log("[Config] got config from server", res);
          set(() => ({ ...res }));
        })
        .catch(() => {
          console.error("[Config] failed to fetch config");
        })
        .finally(() => {
          fetchState = 2;
        });
    },
  }),
  {
    name: StoreKey.Access,
    version: 7.2,
    storage: jchatStorage,
    migrate(persistedState: any, version: number) {
      return persistedState as any;
    },
  },
);
