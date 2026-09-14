import { NextResponse } from "next/server";
import { discardMessages, sendApprovedMessages } from "@/lib/pipeline";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown;
      discard?: unknown;
    };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((value): value is string => typeof value === "string")
      : [];
    if (body.discard) {
      return NextResponse.json(discardMessages(ids));
    }
    const snapshot = await sendApprovedMessages(ids);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ...getSnapshot(), error: message }, { status: 400 });
  }
}
