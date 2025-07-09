import { NextResponse } from "next/server";
import { getServerSideConfig } from "../../config/server";

// 可通过 /api/models 获取如下服务器端配置（公开访问）
async function handle() {
  return NextResponse.json({
    models: getServerSideConfig().models,
  });
}

export const GET = handle;
export const POST = handle;
