import fs from "node:fs";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/mailing/auth";
import { MAILING_LIVE_SHOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** Serve o print ao vivo do browser PAP (mailing scrape). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  if (!fs.existsSync(MAILING_LIVE_SHOT)) {
    return NextResponse.json({ error: "Nenhum print ainda." }, { status: 404 });
  }

  const bytes = fs.readFileSync(MAILING_LIVE_SHOT);
  const stat = fs.statSync(MAILING_LIVE_SHOT);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, max-age=0",
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Shot-Bytes": String(bytes.length),
    },
  });
}
