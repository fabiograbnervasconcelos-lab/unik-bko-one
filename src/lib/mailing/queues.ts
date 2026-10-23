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
  /** Master/admin: ignora bloqueio de “tratando” > 24h. */
  force?: boolean;
  /**
   * Master/admin: também reatribui leads já de outro vendedor
   * (fila tratando / fechadas), não só a pool Transferir.
   */
  reassign?: boolean;
}): Promise<{
  transferred: MailingLead[];
  blocked?: TransferBlockInfo;
  reassigned: number;
  assigned: number;
}> {
  const seller = loadUsers().find((user) => user.id === params.sellerId && user.active);
  if (!seller || !seller.active) {
    throw new Error("Vendedor inválido ou inativo.");
  }
  if (seller.role !== "vendedor" && seller.role !== "admin") {
    throw new Error("Só é possível transferir para vendedor ou administrador.");
  }

  const block = sellerTransferBlock(seller.id);
  if (block.blocked && !params.force) {
    return { transferred: [], blocked: block, reassigned: 0, assigned: 0 };
  }

  const nowIso = new Date().toISOString();
  const idSet = new Set(params.leadIds);
  const transferred: MailingLead[] = [];
  let assigned = 0;
  let reassigned = 0;
  const allowReassign = Boolean(params.reassign);

  await updateLeads((leads) =>
    leads.map((lead) => {
      if (!idSet.has(lead.id)) return lead;

      // Pool Transferir → atribui ao vendedor e abre em tratando
      if (lead.queue === "transferir") {
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
        assigned += 1;
        return next;
      }

      // Já de outro vendedor → master/admin pode reatribuir (mantém a fila atual)
      if (
        allowReassign &&
        lead.assignedTo &&
        lead.assignedTo !== seller.id
      ) {
        const next: MailingLead = {
          ...lead,
          assignedTo: seller.id,
          assignedAt: nowIso,
          treatingSince:
            lead.queue === "tratando" ? nowIso : lead.treatingSince,
          updatedAt: nowIso,
        };
        transferred.push(next);
        reassigned += 1;
        return next;
      }

      return lead;
    }),
  );

  return { transferred, reassigned, assigned };
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
    "ja_contratou_nio",
  ];
  if (!allowed.includes(params.queue)) {
    throw new Error("Fila inválida.");
  }

  const closedQueues: QueueStatus[] = [
    "sem_interesse",
    "sem_resposta",
    "vendido",
    "ja_contratou_nio",
  ];

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

      // Vendedor só move entre tratando / filas fechadas (não devolve para transferir)
      if (!isManager) {
        if (params.queue === "transferir") {
          throw new Error("Vendedor não pode devolver para a fila transferir.");
        }
        if (!isOwner) throw new Error("Lead de outro vendedor.");
      }

      const reopeningToTratando =
        params.queue === "tratando" &&
        (closedQueues.includes(lead.queue) || lead.queue === "transferir");

      const next: MailingLead = {
        ...lead,
        queue: params.queue,
        updatedAt: nowIso,
        treatingSince:
          params.queue === "tratando"
            ? reopeningToTratando
              ? nowIso
              : lead.treatingSince || nowIso
            : lead.treatingSince,
        closedAt: closedQueues.includes(params.queue)
          ? nowIso
          : params.queue === "tratando" || params.queue === "transferir"
            ? null
            : lead.closedAt,
        assignedTo:
          params.queue === "transferir"
            ? null
            : lead.assignedTo || (isOwner ? params.actorId : lead.assignedTo),
        assignedAt:
          params.queue === "transferir"
            ? null
            : lead.assignedAt || (isOwner ? nowIso : lead.assignedAt),
      };

      // Ao abrir (vindo de transferir / reabrir contato) — garante dono + timer 24h
      if (params.queue === "tratando" && !next.assignedTo && isOwner) {
        next.assignedTo = params.actorId;
        next.assignedAt = nowIso;
        next.treatingSince = nowIso;
      }
      if (params.queue === "tratando" && reopeningToTratando && isOwner) {
        next.assignedTo = next.assignedTo || params.actorId;
        next.assignedAt = next.assignedAt || nowIso;
        next.treatingSince = nowIso;
        next.closedAt = null;
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
    ja_contratou_nio: scoped.filter((l) => l.queue === "ja_contratou_nio").length,
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
          lead.queue === "vendido" ||
          lead.queue === "ja_contratou_nio"),
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
