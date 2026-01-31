import { NextRequest, NextResponse } from "next/server";
import { auth } from "../auth";
import { getShareCollection } from "../../lib/mongodb";
import { generateShareId } from "../../utils/share";

const MAX_RETRIES = 5;

type LegacyBody = { title?: string; messages?: unknown[] };
type FullBody = {
  version: number;
  session?: unknown;
  systemPrompt?: unknown;
  messages?: unknown[];
};

function isFullPayload(body: unknown): body is FullBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "version" in body &&
    typeof (body as FullBody).version === "number"
  );
}

export async function POST(req: NextRequest) {
  const authResult = auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: true, msg: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const messages = Array.isArray((body as { messages?: unknown[] })?.messages)
    ? (body as { messages: unknown[] }).messages
    : null;

  if (isFullPayload(body)) {
    // 全量分享：version 存在即按版本化处理，messages 必须为数组（可为空）
    if (!Array.isArray(body.messages)) {
      return NextResponse.json(
        {
          error: true,
          msg: "messages must be an array (can be empty for full share)",
        },
        { status: 400 },
      );
    }
  } else {
    // 旧版：必须有非空 messages
    if (!messages || messages.length === 0) {
      return NextResponse.json(
        {
          error: true,
          msg: "messages is required and must be a non-empty array",
        },
        { status: 400 },
      );
    }
  }

  const collection = await getShareCollection();
  let shareId: string | null = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = generateShareId();
    const existing = await collection.findOne({ shareId: candidate });
    if (!existing) {
      shareId = candidate;
      break;
    }
  }
  if (!shareId) {
    return NextResponse.json(
      { error: true, msg: "Failed to generate unique share id" },
      { status: 500 },
    );
  }

  const base =
    process.env.NEXT_PUBLIC_APP_BASE?.trim() ||
    req.nextUrl.origin ||
    "https://chat.jyj.cx";
  const link = `${base.replace(/\/$/, "")}/s/${shareId}`;

  if (isFullPayload(body)) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    await collection.insertOne({
      shareId,
      version: body.version,
      session: body.session ?? null,
      systemPrompt: body.systemPrompt ?? null,
      messages,
      createdAt: new Date(),
    });
  } else {
    const title =
      typeof (body as LegacyBody).title === "string"
        ? (body as LegacyBody).title?.trim() || undefined
        : undefined;
    await collection.insertOne({
      shareId,
      title,
      messages: messages!,
      createdAt: new Date(),
    });
  }

  return NextResponse.json({ shareId, link });
}
