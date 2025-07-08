import { DEFAULT_MODELS } from "../constant";
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

const customProvider = (name: string) => ({
  id: name.toLowerCase(),
  sorted: CustomSeq.next(name),
});

/**
 * Sorts an array of models based on specified rules.
 */
const sortModelTable = (models: ReturnType<typeof collectModels>) =>
  models.sort((a, b) => {
    if (a.provider && b.provider) {
      let cmp = a.provider.sorted - b.provider.sorted;
      return cmp === 0 ? a.sorted - b.sorted : cmp;
    } else {
      return a.sorted - b.sorted;
    }
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
      available: boolean;
      name: string;
      displayName: string;
      sorted: number;
      provider?: LLMModel["provider"]; // Marked as optional
      isDefault?: boolean;
    }
  > = {};

  // default models
  models.forEach((m) => {
    // using model name as key since we only have one provider
    modelTable[m.name] = {
      ...m,
      displayName: m.name,
    };
  });

  // server custom models
  customModels
    .split(",")
    .filter((v) => !!v && v.length > 0)
    .forEach((m) => {
      const available = !m.startsWith("-");
      const nameConfig =
        m.startsWith("+") || m.startsWith("-") ? m.slice(1) : m;
      let [name, displayName] = nameConfig.split("=");

      // enable or disable all models
      if (name === "all") {
        Object.values(modelTable).forEach(
          (model) => (model.available = available),
        );
      } else {
        // 1. find model by name, and set available value
        const customModelName = name;
        let count = 0;
        for (const modelName in modelTable) {
          if (customModelName === modelName) {
            count += 1;
            modelTable[modelName]["available"] = available;
            if (displayName) {
              modelTable[modelName]["displayName"] = displayName;
            }
          }
        }
        // 2. if model not exists, create new model with available value
        if (count === 0) {
          const provider = customProvider(customModelName);
          modelTable[customModelName] = {
            name: customModelName,
            displayName: displayName || customModelName,
            available,
            provider,
            sorted: CustomSeq.next(customModelName),
          };
        }
      }
    });

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
        if (modelTable[key].available && key === defaultModelName) {
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
