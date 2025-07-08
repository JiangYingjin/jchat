import md5 from "spark-md5";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PROXY_URL?: string; // docker only

      OPENAI_API_KEY?: string;
      CODE?: string;

      BASE_URL?: string;

      CUSTOM_MODELS?: string; // to control custom models

      // custom template for preprocessing user input
      DEFAULT_INPUT_TEMPLATE?: string;
    }
  }
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

function getApiKey(keys?: string) {
  const apiKey = keys?.trim();
  if (apiKey) {
    console.log(`[Server Config] using api key - ${apiKey}`);
  }
  return apiKey;
}

// 获取默认模型：从 CUSTOM_MODELS 中取第一个，如果为空则使用 google/gemini-2.5-flash
function getDefaultModel(customModels: string): string {
  const models = customModels.split(",").filter((v) => !!v && v.length > 0);

  if (models.length > 0) {
    return models[0];
  }

  return "google/gemini-2.5-flash";
}

export const getServerSideConfig = () => {
  if (typeof process === "undefined") {
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );
  }

  let customModels = process.env.CUSTOM_MODELS ?? "";
  let defaultModel = getDefaultModel(customModels);

  return {
    baseUrl: process.env.BASE_URL,
    apiKey: getApiKey(process.env.OPENAI_API_KEY),
    code: process.env.CODE,
    codes: ACCESS_CODES,
    proxyUrl: process.env.PROXY_URL,
    customModels,
    defaultModel,
  };
};
