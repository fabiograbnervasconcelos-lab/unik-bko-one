/**
 * Mapeia o valor do plano (R$) para a velocidade comercial do mailing.
 * 55 / 95 / 110 → 600 mega
 * 70 / 125 / 140 → 800 mega
 * 85 / 100 / 155 / 170 / 185 / 200 → 1GB
 */

const VALOR_TO_PLAN: Record<number, string> = {
  55: "600 mega",
  95: "600 mega",
  110: "600 mega",
  70: "800 mega",
  125: "800 mega",
  140: "800 mega",
  85: "1GB",
  100: "1GB",
  155: "1GB",
  170: "1GB",
  185: "1GB",
  200: "1GB",
};

/** Extrai valor inteiro em reais de strings como "R$ 110,00", "110.00", "110". */
export function parsePlanValorReais(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  const text = String(raw).trim();
  if (!text) return null;

  // Remove símbolo/moeda e espaços
  let s = text.replace(/r\$\s*/gi, "").replace(/\s/g, "");
  // BR: 1.100,00 → milhares; nossos valores são 55–200, então pega o 1º número 2–3 dígitos
  // Preferência: número com centavos "110,00" / "110.00"
  const withCents = s.match(/(\d{1,3})[.,](\d{2})(?!\d)/);
  if (withCents) {
    const n = Number(withCents[1]);
    if (Number.isFinite(n) && n >= 40 && n <= 300) return n;
  }
  // Inteiro isolado
  const ints = [...s.matchAll(/(\d{2,3})/g)].map((m) => Number(m[1]));
  for (const n of ints) {
    if (n in VALOR_TO_PLAN) return n;
  }
  for (const n of ints) {
    if (n >= 40 && n <= 300) return n;
  }
  return null;
}

export function mapPlanLabelByValor(
  valorRaw: string | number | null | undefined,
  extraTexts: Array<string | null | undefined> = [],
): string | null {
  const candidates = [valorRaw, ...extraTexts];
  for (const c of candidates) {
    const n = parsePlanValorReais(c);
    if (n != null && VALOR_TO_PLAN[n]) return VALOR_TO_PLAN[n]!;
  }
  return null;
}

/** Aplica a regra e devolve o rótulo do plano (ou o fallback original). */
export function resolveMailingPlanLabel(params: {
  valorPlano?: string | number | null;
  plano?: string | null;
  velocidade?: string | null;
}): string {
  const mapped = mapPlanLabelByValor(params.valorPlano, [params.plano, params.velocidade]);
  if (mapped) return mapped;
  const fallback = String(params.plano || params.velocidade || "").trim();
  return fallback;
}
