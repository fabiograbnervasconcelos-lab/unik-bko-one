import { NextResponse } from "next/server";
import { getQrPng } from "@/lib/whatsapp";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (getSnapshot().whatsapp === "connected") {
    return new NextResponse(null, { status: 204 });
  }
  const png = await getQrPng();
  if (!png) {
    return new NextResponse("QR ainda não gerado", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
