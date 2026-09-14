import { NextResponse } from "next/server";
import { connectWhatsApp } from "@/lib/whatsapp";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  await connectWhatsApp();
  return NextResponse.json(getSnapshot());
}
