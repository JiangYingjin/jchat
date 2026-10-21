import localforage from "localforage";

const isClient = typeof window !== "undefined";
let storage: LocalForage | null = null;

function getStorage(): LocalForage | null {
  if (!isClient) return null;
  if (!storage) {
    storage = localforage.createInstance({
      name: "JChat",
      storeName: "deviceTransfer",
      description: "Paired device transfer credentials",
    });
  }
  return storage;
}

export const deviceTransferStorage = {
  async getToken(): Promise<string | null> {
    return (await getStorage()?.getItem<string>("deviceToken")) ?? null;
  },
  async setToken(token: string): Promise<void> {
    await getStorage()?.setItem("deviceToken", token);
  },
  async clear(): Promise<void> {
    await getStorage()?.removeItem("deviceToken");
  },
};
