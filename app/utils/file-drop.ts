export interface DroppedFileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  webkitRelativePath?: string;
}

/**
 * 支持的文件扩展名列表
 */
// Image and text detection helpers
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"];

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-javascript",
  "application/sql",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
]);

const TEXT_EXTENSIONS = new Set([
  // docs/markup
  "txt",
  "md",
  "mdx",
  "html",
  "htm",
  "xml",
  "csv",
  "tsv",
  // data/config
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "conf",
  "config",
  "env",
  "log",
  // code
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "go",
  "rs",
  "php",
  "rb",
  "swift",
  "kt",
  "kts",
  "sql",
  "sh",
  "bash",
  "zsh",
  "bat",
  "ps1",
  "psm1",
  "vue",
  "svelte",
  "dart",
  "lua",
  "r",
  "tex",
  "bib",
]);

/**
 * 提取文件信息
 */
export function extractFileInfo(file: File): DroppedFileInfo {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    webkitRelativePath: file.webkitRelativePath,
  };
}

/**
 * 过滤文件列表，只保留支持的文件类型
 */
export function filterSupportedFiles(
  files: DroppedFileInfo[],
): DroppedFileInfo[] {
  return files.filter((file) => isImageFileLike(file) || isTextFileLike(file));
}

/**
 * 按文件名排序文件列表
 */
export function sortFilesByName(files: DroppedFileInfo[]): DroppedFileInfo[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * 格式化文件修改时间
 */
export function formatLastModified(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
}

/**
 * 记录文件信息到控制台
 */
export function logFileInfo(files: DroppedFileInfo[]): void {
  console.group("📁 拖放文件信息");
  console.log(`共接收到 ${files.length} 个文件:`);

  files.forEach((file, index) => {
    console.group(`${index + 1}. ${file.name}`);
    console.log("📄 文件名:", file.name);
    console.log("📏 文件大小:", formatFileSize(file.size));
    console.log("🏷️ 文件类型:", file.type || "未知");
    console.log("⏰ 修改时间:", formatLastModified(file.lastModified));
    if (file.webkitRelativePath) {
      console.log("📂 相对路径:", file.webkitRelativePath);
    }
    console.groupEnd();
  });

  console.groupEnd();
}

/**
 * 验证拖放事件是否包含文件
 */
export function validateDropEvent(event: DragEvent): boolean {
  if (!event.dataTransfer) return false;

  const items = Array.from(event.dataTransfer.items);
  return items.some((item) => item.kind === "file");
}

/**
 * 从拖放事件中提取文件
 */
export function extractFilesFromDrop(event: DragEvent): File[] {
  if (!event.dataTransfer) return [];

  const files: File[] = [];
  const items = Array.from(event.dataTransfer.items);

  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }

  return files;
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex !== -1
    ? fileName.slice(lastDotIndex + 1).toLowerCase()
    : "";
}

/**
 * 判断是否为图片类文件
 */
export function isImageFileLike(file: {
  type?: string;
  name: string;
}): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  const ext = getFileExtension(file.name);
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 判断是否为文本类文件（尽量覆盖常见文本类型，含 HTML 等）
 */
export function isTextFileLike(file: { type?: string; name: string }): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("text/")) return true;
  if (TEXT_MIME_TYPES.has(mimeType)) return true;
  const ext = getFileExtension(file.name);
  return ext ? TEXT_EXTENSIONS.has(ext) : false;
}

/**
 * 根据文件类型获取图标（emoji）
 */
export function getFileIcon(file: DroppedFileInfo): string {
  const ext = getFileExtension(file.name);

  // 图片文件
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext)) {
    return "🖼️";
  }

  // 文档文件
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) {
    return "📄";
  }

  // 表格文件
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return "📊";
  }

  // 演示文件
  if (["ppt", "pptx"].includes(ext)) {
    return "📽️";
  }

  // 代码文件
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "cpp",
      "c",
      "go",
      "rust",
      "php",
      "rb",
      "swift",
    ].includes(ext)
  ) {
    return "💻";
  }

  // 压缩文件
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return "🗜️";
  }

  // 音频文件
  if (["mp3", "wav", "flac", "aac", "ogg"].includes(ext)) {
    return "🎵";
  }

  // 视频文件
  if (["mp4", "avi", "mkv", "mov", "wmv", "flv"].includes(ext)) {
    return "🎬";
  }

  return "📁";
}
