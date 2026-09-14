import type { LeadResult } from "@/lib/store";

export function buildAlertMessage(
  lead: Pick<LeadResult, "crmStatus" | "name" | "cpf" | "gedResult">,
) {
  return [
    "URGENTE — BKO ONE",
    "",
    `Nome: ${lead.name}`,
    `CPF: ${lead.cpf}`,
    `CRM: ${lead.crmStatus}`,
    `Resultado da Análise: ${lead.gedResult}`,
  ].join("\n");
}

export function isPendingWhatsApp(lead: LeadResult) {
  return Boolean(lead.id && lead.draftMessage) && !lead.notified && !lead.skipped;
}
