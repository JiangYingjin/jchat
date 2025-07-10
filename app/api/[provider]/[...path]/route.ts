import { ApiPath } from "@/app/constant";
import { NextRequest } from "next/server";
import { handle as openaiHandler } from "../../openai";

async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path: string[] } },
) {
  const apiPath = `/api/${params.provider}`;
  console.log(`[${params.provider} Route] params `, params);
  switch (apiPath) {
    case ApiPath.OpenAI:
      return openaiHandler(req, { params });
    default:
      return new Response(
        JSON.stringify({
          error: true,
          msg: "unknown api path",
        }),
        {
          status: 404,
        },
      );
  }
}

export const GET = handle;
export const POST = handle;
