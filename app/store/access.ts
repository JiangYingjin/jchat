import { StoreKey, ApiPath, OPENAI_BASE_URL } from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore, jchatStorage } from "../utils/store";
import { ensure } from "../utils/clone";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  useCustomConfig: false,

  provider: "OpenAI",

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // server config
  needCode: true,
  hideUserApiKey: false,
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

    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },

    isAuthorized() {
      this.fetch();

      // has token or has code or disabled access control
      return this.isValidOpenAI() || !this.enabledAccessControl();
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
    async migrate(persistedState: any, version: number) {
      console.log("[AccessStore] 开始数据迁移，版本:", version);

      // 如果没有持久化状态，或者版本已经是最新的，直接返回
      if (!persistedState || version >= 7.2) {
        return persistedState as any;
      }

      // 尝试从旧的存储键中迁移数据
      try {
        const oldKey = "access-control";
        const oldData = await jchatStorage.getItem(oldKey);

        if (oldData && !persistedState) {
          console.log("[AccessStore] 发现旧数据，正在迁移...");

          // 将旧数据复制到新的存储键下
          await jchatStorage.setItem(StoreKey.Access, oldData);

          console.log(
            "[AccessStore] 数据迁移成功，从",
            oldKey,
            "迁移到",
            StoreKey.Access,
          );

          // 保留原始数据不删除，按用户要求
          console.log("[AccessStore] 保留原始数据");

          return oldData as any;
        }
      } catch (error) {
        console.error("[AccessStore] 数据迁移失败:", error);
      }

      return persistedState as any;
    },
  },
);
