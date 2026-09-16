import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  return cors(NextResponse.json({ ok: true, ts: Date.now() }));
}
