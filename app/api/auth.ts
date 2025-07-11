import { NextRequest } from "next/server";
import { getServerSideConfig } from "../utils/config";
import md5 from "spark-md5";

function parseAccessCode(bearToken: string): string {
  return bearToken.trim().replaceAll("Bearer ", "").trim();
}

export function auth(req: NextRequest) {
  const authToken = req.headers.get("Authorization") ?? "";
  const accessCode = parseAccessCode(authToken);
  const hashedCode = md5.hash(accessCode ?? "").trim();
  const serverConfig = getServerSideConfig();
  if (!serverConfig.codes.has(hashedCode)) {
    return {
      error: true,
      msg: !accessCode ? "empty access code" : "wrong access code",
    };
  }
  const apiKey = serverConfig.apiKey;
  if (apiKey) {
    req.headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return { error: false };
}
