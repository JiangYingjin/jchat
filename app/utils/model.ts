export function getModelList(customModels: string) {
  const modelTable: Record<
    string,
    {
      name: string;
      isDefault?: boolean;
    }
  > = {};

  // 处理服务器端自定义模型
  const serverModels = customModels
    .split(",")
    .filter((v) => !!v && v.length > 0);

  const defaultModel = serverModels[0];

  serverModels.forEach((m) => {
    if (m && m.length > 0) {
      modelTable[m] = {
        name: m,
        isDefault: m === defaultModel,
      };
    }
  });

  return Object.values(modelTable);
}
