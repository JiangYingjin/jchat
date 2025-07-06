import { create } from "zustand";
import { combine, persist } from "zustand/middleware";
import { Updater } from "../typing";
import { deepClone } from "./clone";
import localforage from "localforage";

const jchatLocalForageInstance = localforage.createInstance({
  name: "JChat",
  storeName: "default",
});

// 导出底层的 localforage 实例，供 migrate 函数使用以避免循环依赖
export const jchatLocalForage = jchatLocalForageInstance;

export const jchatStorage = {
  async getItem(key: string) {
    return (await jchatLocalForageInstance.getItem(key)) as any;
  },
  async setItem(key: string, value: any) {
    // 过滤掉函数字段
    const filteredValue = JSON.parse(
      JSON.stringify(value, (key, val) => {
        return typeof val === "function" ? undefined : val;
      }),
    );
    return await jchatLocalForageInstance.setItem(key, filteredValue);
  },
  async removeItem(key: string) {
    return await jchatLocalForageInstance.removeItem(key);
  },
};

type SecondParam<T> = T extends (
  _f: infer _F,
  _s: infer S,
  ...args: infer _U
) => any
  ? S
  : never;

type MakeUpdater<T> = {
  lastUpdateTime: number;

  markUpdate: () => void;
  update: Updater<T>;
};

type SetStoreState<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean | undefined,
) => void;

export function createPersistStore<T extends object, M>(
  state: T,
  methods: (
    set: SetStoreState<T & MakeUpdater<T>>,
    get: () => T & MakeUpdater<T>,
  ) => M,
  persistOptions: SecondParam<typeof persist<T & M & MakeUpdater<T>>>,
) {
  return create(
    persist(
      combine(
        {
          ...state,
          lastUpdateTime: 0,
        },
        (set, get) => {
          return {
            ...methods(set, get as any),

            markUpdate() {
              set({ lastUpdateTime: Date.now() } as Partial<
                T & M & MakeUpdater<T>
              >);
            },
            update(updater) {
              const state = deepClone(get());
              updater(state);
              set({
                ...state,
                lastUpdateTime: Date.now(),
              });
            },
          } as M & MakeUpdater<T>;
        },
      ),
      persistOptions as any,
    ),
  );
}
