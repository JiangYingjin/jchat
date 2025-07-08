import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { getModelList } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const models = useMemo(() => {
    return getModelList(accessStore.customModels);
  }, [accessStore.customModels]);

  return models;
}
