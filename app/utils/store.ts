import { create } from "zustand";
import { combine, persist } from "zustand/middleware";
import localforage from "localforage";

// 检查是否在客户端环境
const isClient = typeof window !== "undefined";

let jchatLocalForageInstance: LocalForage | null = null;

// 延迟初始化 localforage 实例
const getJchatLocalForage = (): LocalForage | null => {
  if (!isClient) return null;
  if (!jchatLocalForageInstance) {
    jchatLocalForageInstance = localforage.createInstance({
      name: "JChat",
      storeName: "default",
    });
  }
  return jchatLocalForageInstance;
};

// 导出底层的 localforage 实例，供 migrate 函数使用以避免循环依赖
export const jchatLocalForage = getJchatLocalForage();

export const jchatStorage = {
  async getItem(key: string) {
    const instance = getJchatLocalForage();
    if (!instance) return null; // 服务器端返回null
    return (await instance.getItem(key)) as any;
  },
  async setItem(key: string, value: any) {
    const instance = getJchatLocalForage();
    if (!instance) return; // 服务器端直接返回

    // 过滤掉函数字段
    const filteredValue = JSON.parse(
      JSON.stringify(value, (key, val) => {
        return typeof val === "function" ? undefined : val;
      }),
    );
    return await instance.setItem(key, filteredValue);
  },
  async removeItem(key: string) {
    const instance = getJchatLocalForage();
    if (!instance) return; // 服务器端直接返回
    return await instance.removeItem(key);
  },
};

export type Updater<T> = (updater: (value: T) => void) => void;

export function deepClone<T>(obj: T) {
  return JSON.parse(JSON.stringify(obj));
}

type SecondParam<T> = T extends (
  _f: infer _F,
  _s: infer S,
  ...args: infer _U
) => any
  ? S
  : never;

type MakeUpdater<T> = {
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
      combine(state, (set, get) => {
        return {
          ...methods(set, get as any),
          update(updater) {
            const currentState = deepClone(get());
            updater(currentState);
            set(currentState);
          },
        } as M & MakeUpdater<T>;
      }),
      persistOptions as any,
    ),
  );
}
