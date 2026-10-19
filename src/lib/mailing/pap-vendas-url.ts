/**
 * Helpers de paginação da API PAP /api/portal/vendas
 * (page 1-based + limit=15 no bundle administrativo).
 */

/** Infere a próxima URL comparando dois GETs sucessivos (qual query param subiu). */
export function inferNextVendasUrl(prevUrl: string | null, lastUrl: string | null): string | null {
  if (!prevUrl || !lastUrl) return null;
  try {
    const a = new URL(prevUrl);
    const b = new URL(lastUrl);
    const next = new URL(lastUrl);
    let bumped = false;
    for (const [key, value] of b.searchParams.entries()) {
      const prev = a.searchParams.get(key);
      if (prev == null || prev === value) continue;
      if (!/^-?\d+$/.test(prev) || !/^-?\d+$/.test(value)) continue;
      const diff = Number(value) - Number(prev);
      if (diff === 0) continue;
      next.searchParams.set(key, String(Number(value) + diff));
      bumped = true;
    }
    return bumped ? next.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Monta URL de /vendas para o "from" 1-based do Resultados.
 * PAP usa page 1-based + limit=15 (bundle: page=${t}&limit=15).
 */
export function buildVendasUrlForFrom(
  lastUrl: string,
  from1: number,
  pageSize: number,
  pageZeroBased: boolean | null = null,
): string | null {
  try {
    const u = new URL(lastUrl);
    const limitRaw = Number(
      u.searchParams.get("limit") || u.searchParams.get("size") || pageSize,
    );
    const size = Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : pageSize);
    const page0 = Math.max(0, Math.floor((Math.max(1, from1) - 1) / size));
    const page1 = page0 + 1;
    const pageKeys = [
      "page",
      "pagina",
      "pageNumber",
      "pageIndex",
      "numeroPagina",
      "p",
      "currentPage",
    ];
    for (const k of pageKeys) {
      if (!u.searchParams.has(k)) continue;
      const cur = Number(u.searchParams.get(k));
      const zeroBased =
        pageZeroBased === true ||
        (pageZeroBased !== false && Number.isFinite(cur) && cur === 0);
      u.searchParams.set(k, String(zeroBased ? page0 : page1));
      if (!u.searchParams.has("limit") && !u.searchParams.has("size")) {
        u.searchParams.set("limit", String(size));
      }
      return u.toString();
    }
    for (const k of ["offset", "skip", "from", "start", "inicio"]) {
      if (!u.searchParams.has(k)) continue;
      u.searchParams.set(k, String(Math.max(0, from1 - 1)));
      return u.toString();
    }
    u.searchParams.set("page", String(pageZeroBased === true ? page0 : page1));
    if (!u.searchParams.has("limit")) u.searchParams.set("limit", String(size));
    return u.toString();
  } catch {
    return null;
  }
}
