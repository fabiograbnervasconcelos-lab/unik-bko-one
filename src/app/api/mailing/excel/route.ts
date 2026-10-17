import { NextResponse } from "next/server";
import { canDistribute, getSessionUser } from "@/lib/mailing/auth";
import { buildExcelTemplate, importExcelLeads } from "@/lib/mailing/excel";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const buf = buildExcelTemplate();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-mailing.xlsx"',
    },
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canDistribute(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo Excel." }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importExcelLeads({ buffer, createdBy: user.id });
  return NextResponse.json(result);
}
