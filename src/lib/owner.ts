import { onlyDigits } from "@/lib/text";

/** WhatsApp pessoal do Fabio — avisos horários e comando "validar e enviar". */
export const OWNER_PHONE = process.env.OWNER_WHATSAPP?.replace(/\D/g, "") || "48991940908";

export function ownerDigits(): string {
  const raw = onlyDigits(OWNER_PHONE);
  if (raw.startsWith("55") && raw.length >= 12) return raw;
  return `55${raw}`;
}

export function defaultOwnerJid() {
  return `${ownerDigits()}@s.whatsapp.net`;
}

export function chatDigits(jid: string | null | undefined) {
  if (!jid) return "";
  return onlyDigits(jid.split("@")[0] ?? "");
}

export function isOwnerDirectChat(remoteJid: string | null | undefined, participant?: string | null) {
  if (!remoteJid) return false;
  if (remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast")) return false;
  const wanted = ownerDigits();
  const local = wanted.slice(2);
  const candidates = [remoteJid, participant].filter(Boolean) as string[];
  return candidates.some((id) => {
    const digits = chatDigits(id);
    if (!digits) return false;
    return (
      digits === wanted ||
      digits === local ||
      digits.endsWith(local) ||
      digits.endsWith(wanted)
    );
  });
}
