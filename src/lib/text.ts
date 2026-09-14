export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).padStart(11, "0").slice(-11);
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  return true;
}

export const CPF_REGEX = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g;

export const CRM_STATUS_LABELS = [
  "cancelado/bio expirada",
  "aguardando biometria",
] as const;

export type CrmStatus = (typeof CRM_STATUS_LABELS)[number];

export function matchCrmStatus(text: string): CrmStatus | null {
  const n = normalizeText(text);
  if (!n) return null;
  if (n.includes("aguardando") && n.includes("biometr")) {
    return "aguardando biometria";
  }
  if (
    (n.includes("cancelado") && (n.includes("bio") || n.includes("expir"))) ||
    n.includes("bio expirada") ||
    n.includes("biometria expirada")
  ) {
    return "cancelado/bio expirada";
  }
  return null;
}

const EMPTY_GED_HINT =
  /nenhum registro|nao (foi )?encontr|n[aã]o (foi )?encontr|sem resultado|nenhuma digitaliza|registro n[aã]o localizado|cpf n[aã]o localizado|sem digitaliza/i;

const NEXT_GED_LABEL =
  /(?:\bprotocolo\b|\bcpf\b|\bcnpj\b|\bdata\s|\borigem\b|\boperadora\b|\bvisualizar\b|\bfiltrar\b)/i;

export function looksLikeEmptyGed(pageText: string) {
  return EMPTY_GED_HINT.test(pageText);
}

function cleanGedStatus(raw: string): string | null {
  let value = raw.replace(/\s+/g, " ").trim();
  const cut = value.search(NEXT_GED_LABEL);
  if (cut > 0) value = value.slice(0, cut).trim();
  value = value.replace(/^[:.\-–—|/\\]+/, "").replace(/[:.\-–—|/\\]+$/, "").trim();
  if (value.length < 2 || value.length > 80) return null;
  if (EMPTY_GED_HINT.test(value)) return null;
  if (/^(resultado da an[aá]lise|an[aá]lise|status)$/i.test(value)) return null;
  return value;
}

/** Pega o texto que aparece em Resultado da Análise / Status na tela do GED. */
export function extractGedAnalysis(pageText: string): string | null {
  const patterns = [
    /resultado da an[aá]lise\s*[:\-–—]?\s*([^\n\r|]{2,120})/i,
    /status da an[aá]lise\s*[:\-–—]?\s*([^\n\r|]{2,120})/i,
    /status da digitaliza(?:ção|cao)\s*[:\-–—]?\s*([^\n\r|]{2,120})/i,
  ];
  for (const re of patterns) {
    const match = pageText.match(re);
    if (match?.[1]) {
      const cleaned = cleanGedStatus(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

export function hasDigitizationScreen(pageText: string) {
  if (looksLikeEmptyGed(pageText)) return false;
  return /resultado da an[aá]lise|digitaliza|documento|visualizar/i.test(pageText);
}

export function scoreGroupName(name: string, needles: string[]) {
  const n = normalizeText(name);
  return needles.reduce((score, needle) => score + (n.includes(normalizeText(needle)) ? 1 : 0), 0);
}
