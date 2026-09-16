import { NextResponse } from "next/server";
import { resetCrmAndGedKeepWhatsApp } from "@/lib/reset";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const snapshot = await resetCrmAndGedKeepWhatsApp();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ...getSnapshot(), error: message }, { status: 400 });
  }
}
