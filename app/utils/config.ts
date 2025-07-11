import md5 from "spark-md5";
import { FALLBACK_BASE_URL, FALLBACK_MODEL } from "../constant";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CODE?: string;
      BASE_URL?: string;
      API_KEY?: string;
      MODELS?: string;
      PROXY_URL?: string;
    }
  }
}

export const getServerSideConfig = () => {
  if (typeof process === "undefined")
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );

  let models =
    (process.env.MODELS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => !!v && v.length > 0) || [];
  if (models.length === 0) {
    models = [FALLBACK_MODEL];
  }

  const ACCESS_CODES = (function getAccessCodes(): Set<string> {
    const code = process.env.CODE;
    try {
      const codes = (code?.split(",") ?? [])
        .filter((v) => !!v)
        .map((v) => md5.hash(v.trim()));
      return new Set(codes);
    } catch (e) {
      return new Set();
    }
  })();

  return {
    baseUrl: process.env.BASE_URL || FALLBACK_BASE_URL,
    apiKey: process.env.API_KEY?.trim(),
    code: process.env.CODE,
    codes: ACCESS_CODES,
    proxyUrl: process.env.PROXY_URL,
    models,
  };
};
