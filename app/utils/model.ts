import { LLMModel } from "../client/api";

const CustomSeq = {
  val: -1000, //To ensure the custom model located at front, start from -1000, refer to constant.ts
  cache: new Map<string, number>(),
  next: (id: string) => {
    if (CustomSeq.cache.has(id)) {
      return CustomSeq.cache.get(id) as number;
    } else {
      let seq = CustomSeq.val++;
      CustomSeq.cache.set(id, seq);
      return seq;
    }
  },
};

/**
 * Sorts an array of models based on specified rules.
 */
const sortModelTable = (models: ReturnType<typeof collectModels>) =>
  models.sort((a, b) => {
    return a.sorted - b.sorted;
  });

/**
 * get model name from a formatted string,
 * e.g. `gpt-4` or `gpt-4=GPT-4`
 * @param modelWithDisplay model name with optional display name separated by `=`,
 * @returns model name
 */
export function getModelProvider(modelWithDisplay: string): [string] {
  const [model] = modelWithDisplay.split("=");
  return [model];
}

export function collectModelTable(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable: Record<
    string,
    {
      name: string;
      sorted: number;
      isDefault?: boolean;
    }
  > = {};

  // 处理服务器端自定义模型
  const serverModels = customModels
    .split(",")
    .filter((v) => !!v && v.length > 0);

  if (serverModels.length > 0) {
    // 如果服务器端提供了模型列表，直接使用这些模型
    serverModels.forEach((m) => {
      if (m && m.length > 0) {
        modelTable[m] = {
          name: m,
          sorted: CustomSeq.next(m),
        };
      }
    });
  } else {
    // 只有在没有服务器端模型时，才使用默认模型作为回退
    models.forEach((m) => {
      modelTable[m.name] = {
        name: m.name,
        sorted: m.sorted,
      };
    });
  }

  return modelTable;
}

export function collectModelTableWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  let modelTable = collectModelTable(models, customModels);
  if (defaultModel && defaultModel !== "") {
    const defaultModelName = defaultModel;
    if (defaultModelName in modelTable) {
      modelTable[defaultModelName].isDefault = true;
    } else {
      for (const key of Object.keys(modelTable)) {
        if (key === defaultModelName) {
          modelTable[key].isDefault = true;
          break;
        }
      }
    }
  }
  return modelTable;
}

/**
 * Generate full model table.
 */
export function collectModels(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable = collectModelTable(models, customModels);
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function collectModelsWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  const modelTable = collectModelTableWithDefaultModel(
    models,
    customModels,
    defaultModel,
  );
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}
