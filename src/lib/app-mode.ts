/** Modo do app no Railway: painel BKO/GED, robô WhatsApp CRM ou mailing PAP. */
export type AppMode = "bko" | "whatsapp-crm" | "mailing";

export function getAppMode(): AppMode {
  const raw = (process.env.APP_MODE || "bko").trim().toLowerCase();
  if (raw === "whatsapp-crm" || raw === "whatsapp" || raw === "vendor") {
    return "whatsapp-crm";
  }
  if (raw === "mailing" || raw === "mail" || raw === "pap-mailing") {
    return "mailing";
  }
  return "bko";
}

export function isWhatsAppCrmMode() {
  return getAppMode() === "whatsapp-crm";
}

export function isMailingMode() {
  return getAppMode() === "mailing";
}
