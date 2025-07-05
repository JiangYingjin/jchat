import {
  ServiceProvider,
  StoreKey,
  ApiPath,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
} from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_ANTHROPIC_URL = isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  useCustomConfig: false,

  provider: ServiceProvider.OpenAI,

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // anthropic
  anthropicUrl: DEFAULT_ANTHROPIC_URL,
  anthropicApiKey: "",
  anthropicApiVersion: "2023-06-01",

  // server config
  needCode: true,
  hideUserApiKey: false,
  hideBalanceQuery: false,
  disableGPT4: false,
  disableFastLink: false,
  customModels: "",
  defaultModel: "",
  visionModels: "",
  isEnableRAG: false,
  isEnableWebSearch: false,

  isUseOpenAIEndpointForAllModels: false,
  disableModelProviderDisplay: false,
  isUseRemoteModels: false,
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();
      return get().needCode;
    },
    getVisionModels() {
      this.fetch();
      return get().visionModels;
    },
    isDisableModelProviderDisplay() {
      this.fetch();
      return get().disableModelProviderDisplay;
    },
    useOpenAIEndpointForAllModels() {
      this.fetch();
      return get().isUseOpenAIEndpointForAllModels;
    },
    useRemoteModels() {
      this.fetch();
      return get().isUseRemoteModels;
    },

    enableRAG() {
      this.fetch();
      return get().isEnableRAG;
    },
    enableWebSearch() {
      this.fetch();
      return get().isEnableWebSearch;
    },
    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },
    isValidAnthropic() {
      return ensure(get(), ["anthropicApiKey"]);
    },

    isAuthorized() {
      this.fetch();

      // has token or has code or disabled access control
      return (
        this.isValidOpenAI() ||
        this.isValidAnthropic() ||
        !this.enabledAccessControl()
      );
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
        .then((res: DangerConfig) => {
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

      if (version === 3) {
        const { isEnableRAG, ...rest } = persistedState;
        persistedState = {
          ...rest,
          isEnableRAG: isEnableRAG || false,
        };
      }

      if (version === 4) {
        const { isEnableWebSearch, ...rest } = persistedState;
        persistedState = {
          ...rest,
          isEnableWebSearch: isEnableWebSearch || false,
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

      if (version === 6) {
        const { disableModelProviderDisplay, ...rest } = persistedState;
        persistedState = {
          ...rest,
          disableModelProviderDisplay: disableModelProviderDisplay || false,
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
