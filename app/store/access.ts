import { StoreKey } from "../constant";
import { getHeaders } from "../client/api";
import { createPersistStore, jchatStorage } from "../utils/store";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  models: "",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },
  (set, get) => ({
    fetch() {
      if (fetchState > 0) return;
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
          set(() => ({ ...res })); // 更新 accessStore 的值，直接使用返回的参数
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
