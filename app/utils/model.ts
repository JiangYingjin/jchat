/**
 * 检查是否应该自动切换模型
 * @param systemPromptLength 系统提示词长度
 * @param isManuallySelected 用户是否手动选择了模型
 * @param longTextModel 长文本模型（如果配置了的话）
 * @returns 是否应该自动切换模型
 */
export function shouldAutoSwitchModel(
  systemPromptLength: number,
  isManuallySelected: boolean,
  longTextModel: string | null,
): boolean {
  // 如果用户手动选择了模型，不自动切换
  if (isManuallySelected) {
    console.log("[AutoSwitch] 用户已手动选择模型，跳过自动切换");
    return false;
  }

  // 如果没有配置长文本模型，不自动切换
  if (!longTextModel) {
    console.log("[AutoSwitch] 未配置长文本模型，跳过自动切换");
    return false;
  }

  // 如果系统提示词长度不超过512字符，不自动切换
  if (systemPromptLength < 512) {
    console.log(
      `[AutoSwitch] 系统提示词长度 ${systemPromptLength} 字符，不需要自动切换`,
    );
    return false;
  }

  return true;
}

/**
 * 根据系统提示词内容和当前模型状态，判断是否需要切换到长文本优化模型。
 * @param promptContent 系统提示词内容
 * @param currentModel 当前模型
 * @param longTextModel 长文本模型（如果配置了的话）
 * @param isManuallySelected 用户是否手动选择了模型
 * @returns 新模型名或 null（不切换）
 */
export function determineModelForSystemPrompt(
  promptContent: string,
  currentModel: string,
  longTextModel: string | null,
  isManuallySelected: boolean,
): string | null {
  if (
    shouldAutoSwitchModel(
      promptContent.length,
      isManuallySelected,
      longTextModel,
    )
  ) {
    if (longTextModel && currentModel !== longTextModel) {
      return longTextModel;
    }
  }
  return null;
}

/**
 * 确定组会话的默认模型
 * @param groupSessionModel 组会话模型（如果配置了的话）
 * @param defaultModel 默认模型
 * @returns 选择的模型名称
 */
export function determineModelForGroupSession(
  groupSessionModel: string | null,
  defaultModel: string,
): string {
  // 如果配置了组会话模型，使用它
  if (groupSessionModel) {
    console.log(`[GroupSession] 使用组会话模型 ${groupSessionModel}`);
    return groupSessionModel;
  }

  // 否则使用默认模型
  console.log(`[GroupSession] 使用默认模型 ${defaultModel}`);
  return defaultModel;
}
