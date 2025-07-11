import { PRO_MODEL } from "../constant";

/**
 * 检查是否应该自动切换模型
 * @param systemPromptLength 系统提示词长度
 * @param isManuallySelected 用户是否手动选择了模型
 * @param availableModels 可用的模型列表
 * @returns 是否应该自动切换模型
 */
export function shouldAutoSwitchModel(
  systemPromptLength: number,
  isManuallySelected: boolean,
  availableModels: string[],
): boolean {
  // 如果用户手动选择了模型，不自动切换
  if (isManuallySelected) {
    console.log("[AutoSwitch] 用户已手动选择模型，跳过自动切换");
    return false;
  }

  // 如果系统提示词长度不超过512字符，不自动切换
  if (systemPromptLength < 512) {
    console.log(
      `[AutoSwitch] 系统提示词长度 ${systemPromptLength} 字符，不需要自动切换`,
    );
    return false;
  }

  // 检查是否存在目标模型
  const targetModel = availableModels.find((m) => m === PRO_MODEL);
  if (!targetModel) {
    console.log(
      `[AutoSwitch] 目标模型 ${PRO_MODEL} 不存在或不可用，跳过自动切换`,
    );
    return false;
  }

  return true;
}

/**
 * 根据系统提示词内容和当前模型状态，判断是否需要切换到 PRO_MODEL。
 * @param promptContent 系统提示词内容
 * @param currentModel 当前模型
 * @param allModels 所有可用模型
 * @param isManuallySelected 用户是否手动选择了模型
 * @returns 新模型名或 null（不切换）
 */
export function determineModelForSystemPrompt(
  promptContent: string,
  currentModel: string,
  allModels: string[],
  isManuallySelected: boolean,
): string | null {
  if (
    shouldAutoSwitchModel(promptContent.length, isManuallySelected, allModels)
  ) {
    const targetModel = allModels.find((m) => m === PRO_MODEL);
    if (targetModel && currentModel !== targetModel) {
      return targetModel;
    }
  }
  return null;
}
