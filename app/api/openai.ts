import { getServerSideConfig } from "@/app/utils/config";
import { OPENAI_BASE_URL, OpenaiPath } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";

const serverConfig = getServerSideConfig();

async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const path = req.nextUrl.pathname.replace("/api/openai/", "");
    const base = serverConfig.baseUrl || OPENAI_BASE_URL;
    const baseUrl = base.startsWith("http") ? base : `https://${base}`;

    const fetchUrl = new URL(path, baseUrl);
    console.log("[Proxy] ", path);
    console.log("[Base Url]", baseUrl);

    const fetchOptions: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Authorization: req.headers.get("Authorization") ?? "",
      },
      method: req.method,
      body: req.body,
      redirect: "manual",
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
    };

    const res = await fetch(fetchUrl, fetchOptions);

    // 复制并修改响应头
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    newHeaders.delete("content-encoding"); // 解决Vercel的gzip和OpenAI的br编码冲突
    newHeaders.set("X-Accel-Buffering", "no"); // 禁用nginx缓冲

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// 路由处理逻辑保持不变，因为它已经很清晰
const ALLOWED_PATH = new Set(Object.values(OpenaiPath));

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" });
  }

  const subpath = params.path.join("/");

  if (!ALLOWED_PATH.has(subpath)) {
    return NextResponse.json(
      { error: true, msg: `You are not allowed to request ${subpath}` },
      { status: 403 },
    );
  }

  const authResult = auth(req);
  if (authResult.error) {
    return NextResponse.json(authResult, { status: 401 });
  }

  try {
    return await requestOpenai(req);
  } catch (e) {
    console.error("[OpenAI Proxy Error]", e);
    return NextResponse.json(prettyObject(e), { status: 500 });
  }
}
