import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { SCREENSHOTS_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!/^[a-z0-9.-]+\.png$/i.test(name)) {
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  }
  const filePath = path.join(SCREENSHOTS_DIR, name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Print não encontrado." }, { status: 404 });
  }
  const bytes = fs.readFileSync(filePath);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
