/** Modo do app no Railway: painel BKO/GED ou robô WhatsApp CRM. */
export type AppMode = "bko" | "whatsapp-crm";

export function getAppMode(): AppMode {
  const raw = (process.env.APP_MODE || "bko").trim().toLowerCase();
  if (raw === "whatsapp-crm" || raw === "whatsapp" || raw === "vendor") {
    return "whatsapp-crm";
  }
  return "bko";
}

export function isWhatsAppCrmMode() {
  return getAppMode() === "whatsapp-crm";
}
