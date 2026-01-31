/**
 * MongoDB 连接（与 /www/django/lib/db.py 中 mongo_conn 对齐）
 * 数据库名 jchat，集合 share
 */

import { existsSync, readFileSync } from "fs";
import { MongoClient, Collection, Db } from "mongodb";

const DB_NAME = "jchat";
const COLLECTION_SHARE = "share";

/** 分享文档：兼容旧版 (title + messages) 与版本化全量 (version + session + systemPrompt + messages) */
export interface ShareDoc {
  shareId: string;
  title?: string;
  messages: unknown[];
  createdAt: Date;
  /** 全量分享：payload 版本号 */
  version?: number;
  /** 全量分享：会话元数据 */
  session?: unknown;
  /** 全量分享：系统提示词 */
  systemPrompt?: unknown;
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

/** 组合检测是否在容器内：/.dockerenv 或 /proc/1/cgroup 含 docker/kubepods */
function isLikelyInContainer(): boolean {
  try {
    if (existsSync("/.dockerenv")) return true;
  } catch {
    // ignore
  }
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    if (/docker|kubepods/.test(cgroup)) return true;
  } catch {
    // 非 Linux 或无权限读取时忽略
  }
  return false;
}

function getMongoHost(): string {
  if (process.env.MONGODB_URI) return "";
  if (process.env.MONGODB_HOST) return process.env.MONGODB_HOST;
  if (isLikelyInContainer()) return "host";
  return "127.0.0.1";
}

function getConnectionString(): string {
  const uri = process.env.MONGODB_URI;
  if (uri) return uri;
  const user = process.env.MONGODB_USER ?? "";
  const passwd = process.env.MONGODB_PASSWD ?? "";
  const host = getMongoHost();
  return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(passwd)}@${host}:27017/${DB_NAME}?authSource=admin`;
}

export async function getShareCollection(): Promise<Collection<ShareDoc>> {
  if (cachedDb) {
    return cachedDb.collection<ShareDoc>(COLLECTION_SHARE);
  }
  const uri = getConnectionString();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  await client.db().command({ ping: 1 });
  cachedClient = client;
  cachedDb = client.db(DB_NAME);
  return cachedDb.collection<ShareDoc>(COLLECTION_SHARE);
}
