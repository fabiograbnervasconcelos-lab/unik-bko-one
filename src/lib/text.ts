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

export const GED_ANALYSIS_STATUSES = [
  "Doc. Apto para Venda",
  "Concluído",
  "NÃO PASSÍVEL DE ANÁLISE",
  "ALERTA DE RISCO",
  "NEUTRO",
  "EM ANÁLISE",
  "COM RISCO",
] as const;

const GED_ANALYSIS_NORMALIZED = [
  { label: "Doc. Apto para Venda", keys: ["doc apto para venda", "apto para venda"] },
  { label: "Concluído", keys: ["concluido"] },
  { label: "NÃO PASSÍVEL DE ANÁLISE", keys: ["nao passivel de analise"] },
  { label: "ALERTA DE RISCO", keys: ["alerta de risco"] },
  { label: "NEUTRO", keys: ["neutro"] },
  { label: "EM ANÁLISE", keys: ["em analise"] },
  { label: "COM RISCO", keys: ["com risco"] },
] as const;

export function matchGedAnalysis(text: string): string | null {
  const n = normalizeText(text);
  if (!n) return null;
  for (const item of GED_ANALYSIS_NORMALIZED) {
    if (item.keys.some((key) => n.includes(key))) {
      return item.label;
    }
  }
  return null;
}

export function extractGedAnalysis(pageText: string): string | null {
  const analysisBlock = pageText.match(
    /resultado da an[aá]lise[:\s]*([^\n\r|]{3,80})/i,
  );
  if (analysisBlock?.[1]) {
    const direct = matchGedAnalysis(analysisBlock[1]);
    if (direct) return direct;
  }
  return matchGedAnalysis(pageText);
}

export function looksLikeEmptyGed(pageText: string) {
  return /nenhum registro|nao (foi )?encontr|n[aã]o (foi )?encontr|sem resultado|nenhuma digitaliza|registro n[aã]o localizado/i.test(
    pageText,
  );
}

export function hasDigitizationScreen(pageText: string) {
  if (looksLikeEmptyGed(pageText)) return false;
  return /resultado da an[aá]lise|digitaliza|documento|visualizar/i.test(
    pageText,
  );
}

export function scoreGroupName(name: string, needles: string[]) {
  const n = normalizeText(name);
  return needles.reduce((score, needle) => score + (n.includes(normalizeText(needle)) ? 1 : 0), 0);
}
