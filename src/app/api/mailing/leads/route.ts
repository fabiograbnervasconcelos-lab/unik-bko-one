import { NextResponse } from "next/server";
import { canDistribute, getSessionUser } from "@/lib/mailing/auth";
import { applyPlanMapToLead } from "@/lib/mailing/plan-map";
import { filterLeads, moveLeadQueue, queueCounts } from "@/lib/mailing/queues";
import { loadLeads, loadUsers, updateLeads } from "@/lib/mailing/store";
import type { QueueStatus } from "@/lib/mailing/types";

export const dynamic = "force-dynamic";

/** Reaplica mapeamento valor→velocidade nos leads já salvos (idempotente). */
async function ensurePlanLabelsMapped() {
  let changed = 0;
  await updateLeads((leads) => {
    const next = leads.map((lead) => {
      const mapped = applyPlanMapToLead(lead);
      if (mapped !== lead) changed += 1;
      return mapped;
    });
    return changed ? next : leads;
  });
  return changed;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  // Garante planos antigos (ex.: "Nio Fibra" + R$ 110) viram 600 mega / 800 mega / 1GB
  await ensurePlanLabelsMapped().catch(() => 0);

  const url = new URL(request.url);
  const queue = (url.searchParams.get("queue") || "all") as QueueStatus | "all";
  const search = url.searchParams.get("search") || "";
  const sellerId = url.searchParams.get("sellerId");

  const leads = filterLeads({
    queue,
    search,
    sellerId,
    forUserId: user.id,
    forRole: user.role,
  });

  const all = loadLeads();
  const counts =
    user.role === "vendedor"
      ? queueCounts(
          all.filter((l) => l.assignedTo === user.id),
          user.id,
        )
      : queueCounts(all);

  const sellers = loadUsers()
    .filter((u) => u.active && (u.role === "vendedor" || u.role === "admin"))
    .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role }));

  return NextResponse.json({ leads, counts, sellers });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    leadId?: string;
    queue?: QueueStatus;
  } | null;

  if (!body?.leadId || !body.queue) {
    return NextResponse.json({ error: "leadId e queue são obrigatórios." }, { status: 400 });
  }

  try {
    const lead = await moveLeadQueue({
      leadId: body.leadId,
      queue: body.queue,
      actorId: user.id,
      actorRole: user.role,
    });
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

/** Exclui leads selecionados (remoção permanente do mailing). */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canDistribute(user.role)) {
    return NextResponse.json({ error: "Sem permissão para excluir leads." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    leadIds?: string[];
  } | null;
  const ids = Array.isArray(body?.leadIds)
    ? [...new Set(body!.leadIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Informe leadIds para excluir." }, { status: 400 });
  }

  const idSet = new Set(ids);
  let removed = 0;
  await updateLeads((leads) => {
    const next = leads.filter((lead) => {
      if (!idSet.has(lead.id)) return true;
      removed += 1;
      return false;
    });
    return next;
  });

  return NextResponse.json({ ok: true, removed, requested: ids.length });
}
