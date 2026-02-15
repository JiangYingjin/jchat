import { NextRequest } from "next/server";
import { getServerSideConfig } from "../utils/config";
import md5 from "spark-md5";

function parseBearer(token: string): string {
  return token.trim().replaceAll("Bearer ", "").trim();
}

/** 通用校验：只认访问码（code 通过则用 apiKey 替换）。供 /api/auth-check、/api/share 等使用。 */
export function auth(req: NextRequest) {
  const authToken = req.headers.get("Authorization") ?? "";
  const token = parseBearer(authToken);
  const serverConfig = getServerSideConfig();
  const hashedCode = md5.hash(token ?? "").trim();
  if (!serverConfig.codes.has(hashedCode)) {
    return {
      error: true,
      msg: !token ? "empty access code" : "wrong access code",
    };
  }
  if (serverConfig.apiKey) {
    req.headers.set("Authorization", `Bearer ${serverConfig.apiKey}`);
  }
  return { error: false };
}

/** 仅用于 /api/openai 代理：Bearer 优先。有 Bearer 且非访问码则原样转发；有 Bearer 且是访问码则用 apiKey 转发；无 Bearer 则 401。 */
export function authForOpenai(req: NextRequest) {
  const authToken = req.headers.get("Authorization") ?? "";
  const token = parseBearer(authToken);
  const serverConfig = getServerSideConfig();

  if (!token) {
    return { error: true, msg: "empty access code" };
  }
  const hashedCode = md5.hash(token).trim();
  if (serverConfig.codes.has(hashedCode)) {
    if (serverConfig.apiKey) {
      req.headers.set("Authorization", `Bearer ${serverConfig.apiKey}`);
    }
    return { error: false };
  }
  return { error: false };
}
