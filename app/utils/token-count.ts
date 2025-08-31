import { buildMultimodalContent, cacheImageToBase64Image } from "./chat";

// 简化的图片处理函数
const processImages = async (images: string[]): Promise<string[]> => {
  const results = await Promise.allSettled(
    images.map((imageUrl) => cacheImageToBase64Image(imageUrl)),
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<string> =>
        result.status === "fulfilled" && result.value !== null,
    )
    .map((result) => result.value);
};

// 计算词元数
export const countTokens = async (
  text: string,
  images: string[] = [],
): Promise<number> => {
  try {
    const validImages = await processImages(images);
    const messages = [
      {
        role: "user" as const,
        content: buildMultimodalContent(text, validImages),
      },
    ];

    const response = await fetch("https://dj.jyj.cx/v1/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.total_tokens || 0;
  } catch (error) {
    console.error("Failed to count tokens:", error);
    return Math.ceil(text.length / 4); // 回退到估算值
  }
};

// 简化的缓存实现
const tokenCache = new Map<string, number>();
const MAX_CACHE_SIZE = 100;

export const countTokensWithCache = async (
  text: string,
  images: string[] = [],
): Promise<number> => {
  const cacheKey = `${text}:${images.join(",")}`;

  if (tokenCache.has(cacheKey)) {
    return tokenCache.get(cacheKey)!;
  }

  const tokenCount = await countTokens(text, images);

  // 简单的LRU缓存清理
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) {
      tokenCache.delete(firstKey);
    }
  }

  tokenCache.set(cacheKey, tokenCount);
  return tokenCount;
};
