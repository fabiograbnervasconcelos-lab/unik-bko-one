import { NextResponse } from "next/server";
import { canDistribute, getSessionUser } from "@/lib/mailing/auth";
import { newId } from "@/lib/mailing/crypto";
import { onlyPhone, updateLeads, upsertLeadByKey } from "@/lib/mailing/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canDistribute(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    phone?: string;
    document?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    plan?: string;
    notes?: string;
  } | null;

  const name = body?.name?.trim() || "";
  const phone = onlyPhone(body?.phone || "");
  if (!name || !phone) {
    return NextResponse.json(
      { error: "Nome e telefone são obrigatórios." },
      { status: 400 },
    );
  }

  let created = null as ReturnType<typeof upsertLeadByKey>["lead"] | null;
  await updateLeads((leads) => {
    const result = upsertLeadByKey(leads, {
      id: newId("lead"),
      source: "manual",
      queue: "transferir",
      name,
      phone,
      document: body?.document?.trim() || undefined,
      email: body?.email?.trim() || undefined,
      address: body?.address?.trim() || undefined,
      city: body?.city?.trim() || undefined,
      state: body?.state?.trim() || undefined,
      plan: body?.plan?.trim() || undefined,
      notes: body?.notes?.trim() || undefined,
      createdBy: user.id,
    });
    created = result.lead;
    return result.leads;
  });

  return NextResponse.json({ lead: created });
}
