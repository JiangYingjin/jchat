import { getServerSideConfig } from "@/app/utils/config";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { authForOpenai } from "./auth";

const serverConfig = getServerSideConfig();

async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const path = req.nextUrl.pathname.replace("/api/openai/", "");
    const base = serverConfig.upstreamBaseUrl;
    const baseUrl = base.startsWith("http") ? base : `https://${base}`;

    const fetchUrl = new URL(path, baseUrl);
    // console.log("[Proxy] ", path);
    // console.log("[Base Url]", baseUrl);

    // 将入站 body 读成字符串再转发：把 ReadableStream 直接交给 fetch 指向本机 http 时，Undici 可能发出空 body（Django JSONDecodeError）。
    let forwardBody: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      forwardBody = await req.text();
    }

    const fetchOptions: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Authorization: req.headers.get("Authorization") ?? "",
      },
      method: req.method,
      body: forwardBody,
      redirect: "manual",
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

export async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[]; provider: string }> },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" });
  }
  const authResult = authForOpenai(req);
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
