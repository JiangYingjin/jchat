import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { getModelList } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return getModelList(accessStore.customModels, accessStore.defaultModel);
  }, [accessStore.customModels, accessStore.defaultModel]);

  return models;
}
