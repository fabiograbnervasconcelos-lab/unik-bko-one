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

/** Labels that appear after Resultado da Análise on the GED card (and the Regional footer). */
export const GED_VALUE_STOP =
  /(?:status da digitaliza(?:ção|cao)?|local de digitaliza(?:ção|cao)?|linha\(?s?\)?\s*:|^\s*linha\(?s?\)?|\bregional\b|\bprotocolo\b|\bvisualizar\b|\bfiltrar\b)/i;

const JUNK_GED_VALUE =
  /^(regional|rsul|rnul|r[ns]ul|pdv|linha|linhas?|status|analise|an[aá]lise|conferido|resultado|-|–|—)$/i;

export function isJunkGedAnalysis(value: string) {
  const n = normalizeText(value);
  if (!n || n.length < 2) return true;
  if (JUNK_GED_VALUE.test(n)) return true;
  if (/^regional\b/.test(n)) return true;
  if (/\bregional\b/.test(n) && /\brs?ul\b/.test(n)) return true;
  if (/^status da /.test(n)) return true;
  if (/^local de /.test(n)) return true;
  if (/^linha/.test(n)) return true;
  if (/^resultado da an/.test(n)) return true;
  return false;
}

export function looksLikeEmptyGed(pageText: string) {
  return EMPTY_GED_HINT.test(pageText);
}

export function cleanGedAnalysisValue(raw: string): string | null {
  let value = raw.replace(/\s+/g, " ").trim();
  const cut = value.search(GED_VALUE_STOP);
  if (cut >= 0) value = value.slice(0, cut).trim();
  value = value.replace(/^[:.\-–—|/\\]+/, "").replace(/[:.\-–—|/\\]+$/, "").trim();
  if (value.length < 2 || value.length > 80) return null;
  if (EMPTY_GED_HINT.test(value)) return null;
  if (/^(resultado da an[aá]lise|an[aá]lise|status)$/i.test(value)) return null;
  if (isJunkGedAnalysis(value)) return null;
  return value;
}

/** Pega o texto que aparece em Resultado da Análise na tela do GED, mesmo se a linha sobe ou desce. */
export function extractGedAnalysis(pageText: string): string | null {
  const patterns = [
    /resultado da an[aá]lise\s*[:\-–—]?\s*([^\n\r|]{1,160})/gi,
    /status da an[aá]lise\s*[:\-–—]?\s*([^\n\r|]{1,160})/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(pageText))) {
      const cleaned = cleanGedAnalysisValue(match[1] ?? "");
      if (cleaned) return cleaned;
    }
  }

  const nextLine =
    /resultado da an[aá]lise\s*[:\-–—]?\s*[\n\r]+\s*([^\n\r]{2,160})/gi;
  let match: RegExpExecArray | null;
  while ((match = nextLine.exec(pageText))) {
    const cleaned = cleanGedAnalysisValue(match[1] ?? "");
    if (cleaned) return cleaned;
  }
  return null;
}

export function isValidateAndSendCommand(text: string) {
  const n = normalizeText(text);
  if (!n) return false;
  if (n.length > 80) return false;
  return /\bvalidar\b/.test(n) && /\benviar\b/.test(n);
}

export function hasDigitizationScreen(pageText: string) {
  if (looksLikeEmptyGed(pageText)) return false;
  return /resultado da an[aá]lise|digitaliza|documento|visualizar/i.test(pageText);
}

export function scoreGroupName(name: string, needles: string[]) {
  const n = normalizeText(name);
  return needles.reduce((score, needle) => score + (n.includes(normalizeText(needle)) ? 1 : 0), 0);
}
