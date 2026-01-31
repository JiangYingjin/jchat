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

  return NextResponse.json({
    title: doc.title,
    messages: doc.messages,
  });
}
