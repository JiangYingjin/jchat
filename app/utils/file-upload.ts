import { uploadImage as uploadImageRemote } from "./chat";
import { showToast } from "../components/ui-lib";

/**
 * 拍照上传图片
 * @param attachImages 当前已附加的图片列表
 * @param setAttachImages 设置附加图片的函数
 * @param setUploading 设置上传状态的函数
 * @param saveChatInputImages 保存聊天输入图片的函数
 * @returns Promise<void>
 */
export async function capturePhoto(
  attachImages: string[],
  setAttachImages: (images: string[]) => void,
  setUploading: (uploading: boolean) => void,
  saveChatInputImages: (images: string[]) => Promise<void>,
): Promise<void> {
  const images: string[] = [];
  images.push(...attachImages);

  // 使用原生相机拍照
  const newImages = await new Promise<string[]>((resolve, reject) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.capture = "environment"; // 调用后置摄像头
    fileInput.multiple = false;

    fileInput.onchange = async (event: any) => {
      const file = event.target.files?.[0];
      if (!file) {
        resolve([]);
        return;
      }

      try {
        setUploading(true);
        const dataUrl = await uploadImageRemote(file);
        setUploading(false);
        resolve([dataUrl]);
      } catch (error) {
        setUploading(false);
        console.error("上传拍照图片失败:", error);
        showToast("图片上传失败，请重试");
        reject(error);
      }
    };

    // 如果用户取消拍照，也需要处理
    fileInput.oncancel = () => {
      resolve([]);
    };

    fileInput.click();
  });

  if (newImages.length > 0) {
    images.push(...newImages);
    setAttachImages(images);
    await saveChatInputImages(images);
  }
}

/**
 * 从文件系统选择图片上传
 * @param attachImages 当前已附加的图片列表
 * @param setAttachImages 设置附加图片的函数
 * @param setUploading 设置上传状态的函数
 * @param saveChatInputImages 保存聊天输入图片的函数
 * @returns Promise<void>
 */
export async function uploadImage(
  attachImages: string[],
  setAttachImages: (images: string[]) => void,
  setUploading: (uploading: boolean) => void,
  saveChatInputImages: (images: string[]) => Promise<void>,
): Promise<void> {
  const images: string[] = [];
  images.push(...attachImages);

  images.push(
    ...(await new Promise<string[]>((res, rej) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept =
        "image/png, image/jpeg, image/webp, image/heic, image/heif, image/gif";
      fileInput.multiple = true;
      fileInput.onchange = (event: any) => {
        setUploading(true);
        const files = event.target.files;
        const imagesData: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = event.target.files[i];
          uploadImageRemote(file)
            .then((dataUrl) => {
              imagesData.push(dataUrl);
              if (imagesData.length === files.length) {
                setUploading(false);
                res(imagesData);
              }
            })
            .catch((e) => {
              setUploading(false);
              rej(e);
            });
        }
      };
      fileInput.click();
    })),
  );

  setAttachImages(images);
  await saveChatInputImages(images);
}
