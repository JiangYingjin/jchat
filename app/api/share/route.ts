import { NextRequest, NextResponse } from "next/server";
import { auth } from "../auth";
import { getShareCollection } from "../../lib/mongodb";
import { generateShareId } from "../../utils/share";

const MAX_RETRIES = 5;

export async function POST(req: NextRequest) {
  const authResult = auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg },
      { status: 401 },
    );
  }

  let body: { title?: string; messages?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: true, msg: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return NextResponse.json(
      {
        error: true,
        msg: "messages is required and must be a non-empty array",
      },
      { status: 400 },
    );
  }

  const title =
    typeof body.title === "string" ? body.title.trim() || undefined : undefined;

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

  await collection.insertOne({
    shareId,
    title,
    messages,
    createdAt: new Date(),
  });

  return NextResponse.json({ shareId, link });
}
