import { NextResponse } from "next/server";
import { applyAddressToLead } from "@/lib/mailing/address";
import { canDistribute, getSessionUser } from "@/lib/mailing/auth";
import { applyPlanMapToLead } from "@/lib/mailing/plan-map";
import {
  filterLeads,
  moveLeadQueue,
  queueCounts,
  sellerTransferBlock,
} from "@/lib/mailing/queues";
import { loadLeads, loadUsers, updateLeads } from "@/lib/mailing/store";
import type { QueueStatus } from "@/lib/mailing/types";

export const dynamic = "force-dynamic";

/** Reaplica plano + endereço completo nos leads já salvos (idempotente). */
async function ensureLeadFieldsMapped() {
  let changed = 0;
  await updateLeads((leads) => {
    const next = leads.map((lead) => {
      let mapped = applyPlanMapToLead(lead);
      mapped = applyAddressToLead(mapped);
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

  // Garante planos antigos + endereço completo a partir do raw PAP
  await ensureLeadFieldsMapped().catch(() => 0);

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
      : sellerId
        ? // Master/admin inspecionando a fila de um vendedor (só leads dele)
          queueCounts(all.filter((l) => l.assignedTo === sellerId))
        : queueCounts(all);

  const sellers = loadUsers()
    .filter((u) => u.active && (u.role === "vendedor" || u.role === "admin"))
    .map((u) => {
      const block = sellerTransferBlock(u.id);
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        transferBlocked: Boolean(block.blocked),
        staleTreating: block.staleCount || 0,
      };
    });

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
