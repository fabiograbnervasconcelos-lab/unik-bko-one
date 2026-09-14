import type { LeadResult } from "@/lib/store";

export function buildAlertMessage(
  lead: Pick<LeadResult, "crmStatus" | "name" | "cpf" | "gedResult">,
) {
  return [
    "URGENTE — BKO ONE",
    "",
    `CRM: ${lead.crmStatus}`,
    `Nome: ${lead.name}`,
    `CPF: ${lead.cpf}`,
    `GED360: ${lead.gedResult}`,
    "",
    "Status atual na tela do GED360. Verificar agora.",
  ].join("\n");
}

export function isPendingWhatsApp(lead: LeadResult) {
  return Boolean(lead.id && lead.draftMessage) && !lead.notified && !lead.skipped;
}
