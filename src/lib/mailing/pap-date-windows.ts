/**
 * Janelas de data (dd/mm/aaaa) para contornar o bloqueio do PAP ~500 resultados.
 */

export type BrDateParts = { day: number; month: number; year: number };

export function parseBrDate(value: string): BrDateParts | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
}

export function formatBrDate(parts: BrDateParts): string {
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  return `${dd}/${mm}/${parts.year}`;
}

/** ISO `2026-08-19T…` ou já `dd/mm/aaaa` → `dd/mm/aaaa`. */
export function isoToBrDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const asBr = parseBrDate(raw);
  if (asBr) return formatBrDate(asBr);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return formatBrDate({
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  });
}

export function compareBrDate(a: string, b: string): number {
  const pa = parseBrDate(a);
  const pb = parseBrDate(b);
  if (!pa || !pb) return 0;
  const na = pa.year * 10000 + pa.month * 100 + pa.day;
  const nb = pb.year * 10000 + pb.month * 100 + pb.day;
  return na - nb;
}

export function addDaysBr(parts: BrDateParts, days: number): BrDateParts {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    year: d.getUTCFullYear(),
  };
}

export type DateWindow = {
  from: BrDateParts;
  to: BrDateParts;
  fromBr: string;
  toBr: string;
};

/** Uma janela por dia (mais seguro contra o teto ~500 do PAP). */
export function splitDateRangeDaily(from: BrDateParts, to: BrDateParts): DateWindow[] {
  const out: DateWindow[] = [];
  let cur = { ...from };
  const endBr = formatBrDate(to);
  while (compareBrDate(formatBrDate(cur), endBr) <= 0) {
    const br = formatBrDate(cur);
    out.push({ from: { ...cur }, to: { ...cur }, fromBr: br, toBr: br });
    cur = addDaysBr(cur, 1);
  }
  return out;
}

/** Janelas a partir de resumeBr até dateTo (inclusive). */
export function windowsFromResume(resumeBr: string, dateToBr: string): DateWindow[] {
  const from = parseBrDate(resumeBr);
  const to = parseBrDate(dateToBr);
  if (!from || !to) return [];
  if (compareBrDate(resumeBr, dateToBr) > 0) return [];
  return splitDateRangeDaily(from, to);
}
