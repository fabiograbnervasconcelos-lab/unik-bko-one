import { loadLeads, loadUsers, updateLeads } from "@/lib/mailing/store";
import type {
  MailingLead,
  QueueStatus,
  TransferBlockInfo,
} from "@/lib/mailing/types";

export const TREATING_MAX_MS = 24 * 60 * 60 * 1000;

export function isStaleTreating(lead: MailingLead, now = Date.now()) {
  if (lead.queue !== "tratando" || !lead.treatingSince) return false;
  const since = Date.parse(lead.treatingSince);
  if (!Number.isFinite(since)) return false;
  return now - since > TREATING_MAX_MS;
}

export function sellerTransferBlock(sellerId: string, now = Date.now()): TransferBlockInfo {
  const stale = loadLeads().filter(
    (lead) => lead.assignedTo === sellerId && isStaleTreating(lead, now),
  );
  if (!stale.length) return { blocked: false };
  return {
    blocked: true,
    reason:
      "Transferência bloqueada: este vendedor tem clientes em “tratando” há mais de 24h. Movimente-os antes de receber novos.",
    staleCount: stale.length,
    staleLeads: stale.map((lead) => ({
      id: lead.id,
      name: lead.name,
      treatingSince: lead.treatingSince || "",
    })),
  };
}

export async function transferLeads(params: {
  leadIds: string[];
  sellerId: string;
  actorId: string;
}): Promise<{ transferred: MailingLead[]; blocked?: TransferBlockInfo }> {
  const seller = loadUsers().find((user) => user.id === params.sellerId && user.active);
  if (!seller || seller.role === "master") {
    // master can receive too if role is vendedor/admin; block only missing/inactive
  }
  if (!seller || !seller.active) {
    throw new Error("Vendedor inválido ou inativo.");
  }
  if (seller.role !== "vendedor" && seller.role !== "admin") {
    throw new Error("Só é possível transferir para vendedor ou administrador.");
  }

  const block = sellerTransferBlock(seller.id);
  if (block.blocked) {
    return { transferred: [], blocked: block };
  }

  const nowIso = new Date().toISOString();
  const idSet = new Set(params.leadIds);
  const transferred: MailingLead[] = [];

  await updateLeads((leads) =>
    leads.map((lead) => {
      if (!idSet.has(lead.id)) return lead;
      if (lead.queue !== "transferir") return lead;
      const next: MailingLead = {
        ...lead,
        queue: "tratando",
        assignedTo: seller.id,
        assignedAt: nowIso,
        treatingSince: nowIso,
        closedAt: null,
        updatedAt: nowIso,
      };
      transferred.push(next);
      return next;
    }),
  );

  return { transferred };
}

export async function moveLeadQueue(params: {
  leadId: string;
  queue: QueueStatus;
  actorId: string;
  actorRole: string;
}): Promise<MailingLead> {
  const allowed: QueueStatus[] = [
    "transferir",
    "tratando",
    "sem_interesse",
    "sem_resposta",
    "vendido",
  ];
  if (!allowed.includes(params.queue)) {
    throw new Error("Fila inválida.");
  }

  let updated: MailingLead | null = null;
  const nowIso = new Date().toISOString();

  await updateLeads((leads) =>
    leads.map((lead) => {
      if (lead.id !== params.leadId) return lead;

      const isOwner = lead.assignedTo === params.actorId;
      const isManager = params.actorRole === "master" || params.actorRole === "admin";
      if (!isOwner && !isManager) {
        throw new Error("Sem permissão para mover este lead.");
      }

      // Vendedor só move entre tratando / sem_interesse / sem_resposta / vendido
      if (!isManager) {
        if (params.queue === "transferir") {
          throw new Error("Vendedor não pode devolver para a fila transferir.");
        }
        if (!isOwner) throw new Error("Lead de outro vendedor.");
      }

      const next: MailingLead = {
        ...lead,
        queue: params.queue,
        updatedAt: nowIso,
        treatingSince:
          params.queue === "tratando" ? lead.treatingSince || nowIso : lead.treatingSince,
        closedAt:
          params.queue === "sem_interesse" ||
          params.queue === "sem_resposta" ||
          params.queue === "vendido"
            ? nowIso
            : null,
        assignedTo:
          params.queue === "transferir"
            ? null
            : lead.assignedTo || (isOwner ? params.actorId : lead.assignedTo),
        assignedAt:
          params.queue === "transferir"
            ? null
            : lead.assignedAt || (isOwner ? nowIso : lead.assignedAt),
      };

      // Ao abrir (vindo de transferir implícito) — se manager manda para tratando sem assigned
      if (params.queue === "tratando" && !next.assignedTo && isOwner) {
        next.assignedTo = params.actorId;
        next.assignedAt = nowIso;
        next.treatingSince = nowIso;
      }

      updated = next;
      return next;
    }),
  );

  if (!updated) throw new Error("Lead não encontrado.");
  return updated;
}

export function queueCounts(leads: MailingLead[], sellerId?: string | null) {
  const scoped = sellerId
    ? leads.filter((lead) => lead.assignedTo === sellerId || lead.queue === "transferir")
    : leads;
  return {
    transferir: scoped.filter((l) => l.queue === "transferir").length,
    tratando: scoped.filter((l) => l.queue === "tratando").length,
    sem_interesse: scoped.filter((l) => l.queue === "sem_interesse").length,
    sem_resposta: scoped.filter((l) => l.queue === "sem_resposta").length,
    vendido: scoped.filter((l) => l.queue === "vendido").length,
    staleTreating: scoped.filter((l) => isStaleTreating(l)).length,
    total: scoped.length,
  };
}

export function filterLeads(params: {
  queue?: QueueStatus | "all";
  sellerId?: string | null;
  search?: string;
  forUserId?: string;
  forRole?: string;
}) {
  let leads = loadLeads();
  if (params.forRole === "vendedor" && params.forUserId) {
    leads = leads.filter(
      (lead) =>
        lead.assignedTo === params.forUserId &&
        (lead.queue === "tratando" ||
          lead.queue === "sem_interesse" ||
          lead.queue === "sem_resposta" ||
          lead.queue === "vendido"),
    );
  }
  if (params.queue && params.queue !== "all") {
    leads = leads.filter((lead) => lead.queue === params.queue);
  }
  if (params.sellerId) {
    leads = leads.filter((lead) => lead.assignedTo === params.sellerId);
  }
  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase();
    leads = leads.filter((lead) =>
      [
        lead.name,
        lead.phone,
        lead.document,
        lead.email,
        lead.plan,
        lead.city,
        lead.address,
        lead.part2?.enderecoCompleto,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }
  return leads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
