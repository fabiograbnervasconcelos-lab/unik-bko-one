import { NextResponse } from "next/server";
import { saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const settings = saveSettings({
    crmUser: body.crmUser ?? "",
    crmPass: body.crmPass ?? "",
    gedUser: body.gedUser ?? "",
    gedPass: body.gedPass ?? "",
    gedDomain: body.gedDomain === "2" ? "2" : "1",
    groupBko: body.groupBko || "bko one urgente",
    groupGerentes: body.groupGerentes || "gerentes one",
    extraCpfs: body.extraCpfs ?? "",
  });
  return NextResponse.json({ ok: true, settings });
}
