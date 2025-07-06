import { StoreKey, ApiPath, OPENAI_BASE_URL } from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
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
  hideBalanceQuery: false,
  customModels: "",
  defaultModel: "",

  isUseOpenAIEndpointForAllModels: false,
  isUseRemoteModels: false,
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();
      return get().needCode;
    },
    useOpenAIEndpointForAllModels() {
      this.fetch();
      return get().isUseOpenAIEndpointForAllModels;
    },
    useRemoteModels() {
      this.fetch();
      return get().isUseRemoteModels;
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

    migrate(persistedState: any, version: number) {
      if (version === 2) {
        const { defaultModel, ...rest } = persistedState;
        persistedState = {
          ...rest,
          defaultModel: defaultModel || "",
        };
      }

      if (version === 4) {
        const { isEnableWebSearch, ...rest } = persistedState;
        persistedState = {
          ...rest,
        };
      }

      if (version === 5) {
        const { isUseOpenAIEndpointForAllModels, ...rest } = persistedState;
        persistedState = {
          ...rest,
          isUseOpenAIEndpointForAllModels:
            isUseOpenAIEndpointForAllModels || false,
        };
      }

      if (version === 7) {
        const { isUseRemoteModels, ...rest } = persistedState;
        persistedState = {
          ...rest,
          isUseRemoteModels: isUseRemoteModels || false,
        };
      }

      return persistedState as any;
    },
  }),
  {
    name: StoreKey.Access,
    version: 7,
  },
);
