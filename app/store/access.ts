import { StoreKey, ApiPath, OPENAI_BASE_URL } from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore, jchatStorage } from "../utils/store";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_ACCESS_STATE = {
  accessCode: "",

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,

  // server config
  needCode: true,
  customModels: "",
  defaultModel: "",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();
      return get().needCode;
    },

    isAuthorized() {
      this.fetch();

      // has code or disabled access control
      return !this.enabledAccessControl();
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
      // 简化 migrate 函数，只做版本兼容性处理
      // 数据迁移改为在应用启动时主动执行，使用 app/utils/migration.ts 并在 app/components/home.tsx 中调用
      return persistedState as any;
    },
  },
);
