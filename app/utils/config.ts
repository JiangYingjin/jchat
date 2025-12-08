import md5 from "spark-md5";
import { FALLBACK_BASE_URL } from "../constant";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CODE?: string;
      BASE_URL?: string;
      API_KEY?: string;
      MODELS?: string;
      LONG_TEXT_MODEL?: string;
      GROUP_SESSION_MODEL?: string;
      PROXY_URL?: string;
    }
  }
}

export const getServerSideConfig = () => {
  if (typeof process === "undefined")
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );

  // 检查是否在构建阶段（Next.js 构建时会设置 NEXT_PHASE）
  const isBuildTime =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-development-build";

  // 验证 MODELS 环境变量
  const modelsString = process.env.MODELS?.trim();
  if (!modelsString) {
    // 构建时允许为空，不报错，也不使用默认模型
    if (isBuildTime) {
      return {
        baseUrl: process.env.BASE_URL || FALLBACK_BASE_URL,
        apiKey: process.env.API_KEY?.trim(),
        code: process.env.CODE,
        codes: new Set<string>(),
        proxyUrl: process.env.PROXY_URL,
        models: [],
        longTextModel: null,
        groupSessionModel: null,
        defaultModel: undefined,
      };
    }
    // 运行时才抛出错误
    throw new Error(
      "[Server Config] MODELS environment variable is required but not set. " +
        "Please set MODELS to a comma-separated list of available models, e.g., 'model1,model2,model3'",
    );
  }

  const models = modelsString
    .split(",")
    .map((v) => v.trim())
    .filter((v) => !!v && v.length > 0);

  if (models.length === 0) {
    // 构建时允许为空，不报错
    if (isBuildTime) {
      return {
        baseUrl: process.env.BASE_URL || FALLBACK_BASE_URL,
        apiKey: process.env.API_KEY?.trim(),
        code: process.env.CODE,
        codes: new Set<string>(),
        proxyUrl: process.env.PROXY_URL,
        models: [],
        longTextModel: null,
        groupSessionModel: null,
        defaultModel: undefined,
      };
    }
    // 运行时才抛出错误
    throw new Error(
      "[Server Config] MODELS environment variable is empty or contains no valid models. " +
        "Please provide at least one valid model name.",
    );
  }

  // 验证 LONG_TEXT_MODEL 环境变量（可选）
  const longTextModel = process.env.LONG_TEXT_MODEL?.trim();
  const validLongTextModel =
    longTextModel && models.includes(longTextModel) ? longTextModel : null;

  // 验证 GROUP_SESSION_MODEL 环境变量（可选）
  const groupSessionModel = process.env.GROUP_SESSION_MODEL?.trim();
  const validGroupSessionModel =
    groupSessionModel && models.includes(groupSessionModel)
      ? groupSessionModel
      : null;

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
    longTextModel: validLongTextModel,
    groupSessionModel: validGroupSessionModel,
    defaultModel: models.length > 0 ? models[0] : undefined,
  };
};
