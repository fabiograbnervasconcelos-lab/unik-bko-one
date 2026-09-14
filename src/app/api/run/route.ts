import { NextResponse } from "next/server";
import { startPipeline } from "@/lib/pipeline";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const snapshot = startPipeline();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ...getSnapshot(), error: message }, { status: 400 });
  }
}
