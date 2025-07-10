import { NextRequest, NextResponse } from "next/server";
import { auth } from "../auth";

export async function POST(req: NextRequest) {
  try {
    // 使用现有的 auth 函数进行验证
    const authResult = auth(req);

    if (authResult.error) {
      return NextResponse.json(
        {
          error: true,
          msg: authResult.msg,
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        error: false,
        msg: "authorized",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Auth Check] Error:", error);
    return NextResponse.json(
      {
        error: true,
        msg: "internal server error",
      },
      { status: 500 },
    );
  }
}
