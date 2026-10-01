/** Extrai só dígitos — evita alias @/ nos testes Node. */
function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Número oficial do robô de vendedores (WhatsApp CRM).
 * O painel BKO usa outro número e NÃO deve atender o bot.
 */
export const ROBOT_WHATSAPP =
  process.env.ROBOT_WHATSAPP?.replace(/\D/g, "") || "48996450101";

/** Número oficial do painel CRM × GED (unik-bko-one). */
export const BKO_WHATSAPP =
  process.env.BKO_WHATSAPP?.replace(/\D/g, "") || "47997860234";

function toBrazilDigits(rawInput: string) {
  const raw = onlyDigits(rawInput);
  if (raw.startsWith("55") && raw.length >= 12) return raw;
  return `55${raw}`;
}

/** Variantes com/sem o 9º dígito (WhatsApp às vezes omite). */
export function phoneDigitVariants(fullOrLocal: string): string[] {
  const full = toBrazilDigits(fullOrLocal);
  const out = new Set<string>([full]);
  if (full.startsWith("55") && full.length === 13) {
    // 55 + DD + 9XXXXXXXX → sem o 9
    out.add(full.slice(0, 4) + full.slice(5));
  }
  if (full.startsWith("55") && full.length === 12) {
    // 55 + DD + XXXXXXXX → com o 9
    out.add(full.slice(0, 4) + "9" + full.slice(4));
  }
  const local = full.replace(/^55/, "");
  out.add(local);
  if (local.length === 11 && local[2] === "9") out.add(local.slice(0, 2) + local.slice(3));
  if (local.length === 10) out.add(local.slice(0, 2) + "9" + local.slice(2));
  return [...out];
}

export function robotDigits(): string {
  return toBrazilDigits(ROBOT_WHATSAPP);
}

export function bkoDigits(): string {
  return toBrazilDigits(BKO_WHATSAPP);
}

function matchesPhone(jidOrDigits: string | null | undefined, wantedFull: string) {
  if (!jidOrDigits) return false;
  const digits = onlyDigits(String(jidOrDigits).split(/[:@]/)[0] || "");
  if (!digits) return false;
  const wanted = phoneDigitVariants(wantedFull);
  const got = phoneDigitVariants(digits);
  return wanted.some((w) => got.includes(w));
}

/** Sessão do robô de vendedores = 48 99645-0101. */
export function isAllowedRobotNumber(jidOrDigits: string | null | undefined): boolean {
  return matchesPhone(jidOrDigits, robotDigits());
}

/** Sessão do painel BKO = 47 99786-0234. */
export function isAllowedBkoNumber(jidOrDigits: string | null | undefined): boolean {
  return matchesPhone(jidOrDigits, bkoDigits());
}

export function formatPhoneDisplay(fullDigits: string) {
  const local = toBrazilDigits(fullDigits).replace(/^55/, "");
  // Prefere exibir com 9 se tiver 10 dígitos locais
  const show =
    local.length === 10 ? `${local.slice(0, 2)}9${local.slice(2)}` : local;
  if (show.length === 11) {
    return `${show.slice(0, 2)} ${show.slice(2, 7)}-${show.slice(7)}`;
  }
  return show;
}

export function formatRobotPhoneDisplay() {
  return formatPhoneDisplay(robotDigits());
}

export function formatBkoPhoneDisplay() {
  return formatPhoneDisplay(bkoDigits());
}
