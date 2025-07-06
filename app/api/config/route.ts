import { NextResponse } from "next/server";

import { getServerSideConfig } from "../../config/server";

const serverConfig = getServerSideConfig();

// Danger! Do not hard code any secret value here!
// 警告！不要在这里写入任何敏感信息！
const DANGER_CONFIG = {
  needCode: serverConfig.needCode,
  customModels: serverConfig.customModels,
  defaultModel: serverConfig.defaultModel,

  isUseOpenAIEndpointForAllModels: serverConfig.isUseOpenAIEndpointForAllModels,
  isUseRemoteModels: serverConfig.isUseRemoteModels,
};

async function handle() {
  return NextResponse.json(DANGER_CONFIG);
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
