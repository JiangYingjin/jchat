import { showToast } from "../components/ui-lib";

/**
 * 复制图像到剪切板
 * - 如果图像是 PNG 格式，直接复制
 * - 如果是其他格式，转换为 PNG 并设置最大宽度为 1920px
 * @param imageUrl 图像 URL
 */
export async function copyImageToClipboard(imageUrl: string) {
  console.log("=== 开始复制图像到剪切板 ===");
  console.log("图像URL:", imageUrl);

  // 检查浏览器兼容性
  const hasClipboardAPI = "clipboard" in navigator;
  const hasWritePermission = hasClipboardAPI && "write" in navigator.clipboard;

  if (!hasWritePermission) {
    console.log("❌ 浏览器不支持剪切板写入功能");
    showToast("浏览器不支持剪切板功能");
    return;
  }

  // 确保文档获得焦点
  const ensureDocumentFocus = async () => {
    if (!document.hasFocus()) {
      console.log("文档失去焦点，尝试恢复焦点...");
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!document.hasFocus()) {
        document.body.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  try {
    // 获取图像 blob
    console.log("获取图像数据...");
    let blob: Blob;

    if (imageUrl.startsWith("data:")) {
      const response = await fetch(imageUrl);
      blob = await response.blob();
    } else {
      const response = await fetch(imageUrl, {
        mode: "cors",
        credentials: "omit",
      });
      blob = await response.blob();
    }

    console.log(
      "图像数据获取成功, MIME类型:",
      blob.type,
      "大小:",
      (blob.size / 1024 / 1024).toFixed(2) + "MB",
    );

    // 如果是 PNG 类型，直接复制
    if (blob.type === "image/png") {
      console.log("检测到 PNG 格式，直接复制...");
      await ensureDocumentFocus();
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      console.log("✅ PNG 直接复制成功!");
      showToast("图像已复制到剪切板");
      return;
    }

    // 非 PNG 格式，转换为 PNG 并设置最大宽度
    console.log("非 PNG 格式，开始转换为 PNG...");

    const img = new Image();
    img.crossOrigin = "anonymous";

    const objectUrl = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        console.log("图像加载成功, 原始尺寸:", img.width, "x", img.height);
        resolve();
      };
      img.onerror = (e) => {
        console.log("图像加载失败:", e);
        reject(new Error("图像加载失败"));
      };
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法获取 canvas context");
    }

    // 设置最大宽度并计算缩放尺寸
    const MAX_WIDTH = 1920; // 最大宽度
    let drawWidth = img.width;
    let drawHeight = img.height;

    if (img.width > MAX_WIDTH) {
      drawWidth = MAX_WIDTH;
      drawHeight = (img.height / img.width) * MAX_WIDTH;
      console.log("图像过大，缩放到:", drawWidth, "x", drawHeight);
    } else {
      console.log("图像尺寸合适，保持原始尺寸:", drawWidth, "x", drawHeight);
    }

    canvas.width = drawWidth;
    canvas.height = drawHeight;
    ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
    console.log("Canvas 绘制完成");

    // 清理 object URL
    URL.revokeObjectURL(objectUrl);

    // 转换为 PNG
    console.log("转换为 PNG 格式...");
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          console.log(
            "PNG 转换成功, 最终大小:",
            (blob.size / 1024 / 1024).toFixed(2) + "MB",
          );
          resolve(blob);
        } else {
          reject(new Error("无法创建 PNG blob"));
        }
      }, "image/png");
    });

    // 复制到剪切板
    await ensureDocumentFocus();
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": pngBlob,
      }),
    ]);

    console.log("✅ PNG 转换并复制成功!");
    showToast("图像已复制到剪切板");
  } catch (error) {
    console.log("❌ 图像复制失败:", error);
    showToast("复制失败，请重试");
  }
}
