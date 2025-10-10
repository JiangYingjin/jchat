import { NextResponse } from "next/server";
import { getServerSideConfig } from "../../utils/config";

// 可通过 /api/models 获取如下服务器端配置（公开访问）
async function handle() {
  try {
    const config = getServerSideConfig();
    return NextResponse.json({
      models: config.models,
      longTextModel: config.longTextModel,
      groupSessionModel: config.groupSessionModel,
      defaultModel: config.defaultModel,
    });
  } catch (error) {
    console.error("[API Models] 配置错误:", error);
    return NextResponse.json(
      {
        error: true,
        message: error instanceof Error ? error.message : "配置错误",
      },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
