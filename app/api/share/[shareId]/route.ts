import { NextRequest, NextResponse } from "next/server";
import { getShareCollection } from "../../../lib/mongodb";
import { isValidShareId } from "../../../utils/share";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  if (!isValidShareId(shareId)) {
    return NextResponse.json({ error: "Invalid share id" }, { status: 400 });
  }

  const collection = await getShareCollection();
  const doc = await collection.findOne({ shareId });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 版本化全量分享：返回完整 payload，便于载入时无损恢复；displayMessageIds 有则仅展示这些消息
  if (typeof doc.version === "number") {
    return NextResponse.json({
      version: doc.version,
      session: doc.session ?? null,
      systemPrompt: doc.systemPrompt ?? null,
      messages: doc.messages ?? [],
      ...(Array.isArray(doc.displayMessageIds) &&
      doc.displayMessageIds.length > 0
        ? { displayMessageIds: doc.displayMessageIds }
        : {}),
    });
  }

  // 旧版：仅 title + messages
  return NextResponse.json({
    title: doc.title,
    messages: doc.messages ?? [],
  });
}
