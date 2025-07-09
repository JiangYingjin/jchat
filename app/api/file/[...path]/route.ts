import LocalFileStorage from "@/app/utils/local_file_storage";
import { NextRequest, NextResponse } from "next/server";
import mime from "mime";

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  try {
    const fileName = params.path[0];
    const contentType = mime.getType(fileName);

    var fileBuffer = await LocalFileStorage.get(fileName);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
      },
    });
  } catch (e) {
    return new Response("not found", {
      status: 404,
    });
  }
}

export const GET = handle;

export const runtime = "nodejs";
export const revalidate = 0;
