import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../auth";
import { getShareCollection } from "../../../lib/mongodb";
import { isValidShareId } from "../../../utils/share";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const authResult = auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg },
      { status: 401 },
    );
  }

  const { shareId } = await params;
  if (!isValidShareId(shareId)) {
    return NextResponse.json({ error: "Invalid share id" }, { status: 400 });
  }

  let body: { shareTitle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: true, msg: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const shareTitle =
    typeof body.shareTitle === "string" ? body.shareTitle.trim() : undefined;
  if (!shareTitle) {
    return NextResponse.json(
      {
        error: true,
        msg: "shareTitle is required and must be a non-empty string",
      },
      { status: 400 },
    );
  }

  const collection = await getShareCollection();
  const result = await collection.updateOne(
    { shareId },
    { $set: { shareTitle } },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ shareTitle });
}

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

  // 版本化全量分享：返回完整 payload，便于载入时无损恢复；displayMessageIds 有则仅展示这些消息；shareTitle 有则优先用于分享页展示
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
      ...(typeof doc.shareTitle === "string" && doc.shareTitle.trim() !== ""
        ? { shareTitle: doc.shareTitle.trim() }
        : {}),
    });
  }

  // 旧版：仅 title + messages；shareTitle 有则一并返回
  return NextResponse.json({
    title: doc.title,
    messages: doc.messages ?? [],
    ...(typeof doc.shareTitle === "string" && doc.shareTitle.trim() !== ""
      ? { shareTitle: doc.shareTitle.trim() }
      : {}),
  });
}
