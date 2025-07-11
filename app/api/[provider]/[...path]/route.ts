import { ApiPath } from "@/app/constant";
import { NextRequest } from "next/server";
import { handle as openaiHandler } from "../../openai";

function handle(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const parts = pathname.split("/").filter(Boolean);
  const provider = parts[1]; // api/[provider]/...
  const path = parts.slice(2); // [...path]

  const apiPath = `/api/${provider}`;
  console.log(`[${provider} Route] params `, { provider, path });
  switch (apiPath) {
    case ApiPath.OpenAI:
      return openaiHandler(req, {
        params: Promise.resolve({ path, provider }),
      });
    default:
      return new Response(
        JSON.stringify({
          error: true,
          msg: "unknown api path",
        }),
        { status: 404 },
      );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
