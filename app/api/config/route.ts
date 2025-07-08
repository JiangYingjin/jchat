import { NextResponse } from "next/server";
import { getServerSideConfig } from "../../config/server";

const serverConfig = getServerSideConfig();

// Danger! Do not hard code any secret value here!
// 警告！不要在这里写入任何敏感信息！

// 可通过 /api/config 获取如下服务器端配置
const PUBLIC_CONFIG = {
  models: serverConfig.models,
};

async function handle() {
  return NextResponse.json(PUBLIC_CONFIG);
}

export const GET = handle;
export const POST = handle;
