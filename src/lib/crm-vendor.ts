import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log } from "@/lib/store";
import {
  buildRowFromText,
  currentMonthParts,
  filterRows,
  formatQueryTimestamp,
  type VendorCrmRow,
  type VendorQueryKind,
  type VendorQueryResult,
} from "@/lib/vendor-helpers";

const CRM_LOGIN = "https://uniktelecom.com.br/proadmin/login.php";
const CRM_BASE = "https://uniktelecom.com.br/proadmin";

/** Só NIO — nunca Tim Fibra (operadora 7). */
export const CRM_NIO_HISTORICO = `${CRM_BASE}/consultarHistoricos.php?active=historicos8&operadora=8`;
export const CRM_NIO_PREVENDA = `${CRM_BASE}/consultarPrevendas.php?active=prevendas8&operadora=8`;
export const CRM_LOGOUT_URLS = [`${CRM_BASE}/sair.php`, `${CRM_BASE}/logout.php`];

export type { VendorCrmRow, VendorQueryKind, VendorQueryResult };

async function waitForTable(page: Page) {
  await page
    .locator("#table_default, table.dataTable, table")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => undefined);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
}

async function applySearch(page: Page, query: string) {
  const search = page.locator(".dataTables_filter input, #table_default_filter input").first();
  if (!(await search.count())) return false;
  await search.click({ timeout: 4000 }).catch(() => undefined);
  await search.fill("");
  await search.fill(query);
  await page.waitForTimeout(2000);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  return true;
}

async function showHundredRows(page: Page) {
  const lengthSelect = page.locator("select[name$='_length']").first();
  if (await lengthSelect.count()) {
    await lengthSelect.selectOption("100").catch(() => undefined);
    await page.waitForTimeout(1200);
    await page
      .locator(".dataTables_processing")
      .waitFor({ state: "hidden", timeout: 15000 })
      .catch(() => undefined);
  }
}

async function gotoNextPage(page: Page) {
  const next = page.locator("#table_default_next, a.paginate_button.next, a:has-text('Próxima')").first();
  if (!(await next.count())) return false;
  const className = (await next.getAttribute("class")) ?? "";
  if (/\bdisabled\b/i.test(className)) return false;
  await next.click({ timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(1400);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  return !/\bdisabled\b/i.test((await next.getAttribute("class")) ?? "");
}

function parseRowsFromPageText(text: string, kind: VendorQueryKind): VendorCrmRow[] {
  const chunks = text.split(/\n(?=#\d+)/);
  const blocks = chunks.length > 1 ? chunks : text.split(/\n{2,}/);
  const rows: VendorCrmRow[] = [];
  for (const block of blocks) {
    const row = buildRowFromText(block, kind);
    if (row) rows.push(row);
  }
  return rows;
}

async function extractTableRows(page: Page, kind: VendorQueryKind): Promise<VendorCrmRow[]> {
  const rows = page.locator("#table_default tbody tr, table.dataTable tbody tr");
  const count = await rows.count();
  const found: VendorCrmRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const rowText = (await row.innerText().catch(() => "")) || "";
    if (!rowText.trim() || /nenhum (dado|registro)/i.test(rowText)) continue;
    const cells = await row.locator("td").allInnerTexts().catch(() => [] as string[]);
    const joined = cells.length ? cells.map((cell) => cell.trim()).filter(Boolean).join("\n") : rowText;
    const parsed = buildRowFromText(joined, kind) ?? buildRowFromText(rowText, kind);
    if (parsed) found.push(parsed);
  }
  if (found.length) return found;
  return parseRowsFromPageText(await visibleText(page), kind);
}

async function collectBySearch(page: Page, url: string, search: string, kind: VendorQueryKind) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForTable(page);
  await showHundredRows(page);
  const searched = await applySearch(page, search);
  if (!searched) {
    log("warn", `CRM vendedor: campo pesquisar não apareceu (${kind}).`);
  }
  await screenshot(page, `vendor-${kind}-search`);

  const all: VendorCrmRow[] = [];
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
    const batch = await extractTableRows(page, kind);
    for (const row of batch) {
      const key = `${row.cpf ?? ""}|${row.os ?? ""}|${row.name}|${row.status}|${row.agenda ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }
    const moved = await gotoNextPage(page);
    if (!moved) break;
  }
  return filterRows(kind, all);
}

export async function loginCrmAsVendor(page: Page, user: string, pass: string) {
  await page.goto(CRM_LOGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
  await fillFirst(page, ['input[name="usuario"]', 'input[placeholder="Usuario"]'], user.trim());
  await fillFirst(page, ['input[name="senha"]', 'input[type="password"]'], pass);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    clickFirst(page, ['button[type="submit"]', 'button:has-text("Entrar")']),
  ]);
  await page.waitForTimeout(2500);

  const denied = page.locator(".sweet-alert, .swal2-popup, .sa-error").first();
  if (await denied.isVisible().catch(() => false)) {
    const deniedText = (await denied.innerText().catch(() => "")) || "";
    if (/acesso negado|dados incorretos|incorreto/i.test(deniedText)) {
      throw new Error("CRM_LOGIN_DENIED");
    }
  }

  if (page.url().includes("login.php")) {
    throw new Error("CRM_LOGIN_DENIED");
  }

  await page.goto(CRM_NIO_HISTORICO, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  if (page.url().includes("login.php")) {
    throw new Error("CRM_LOGIN_DENIED");
  }
  log("info", `CRM vendedor autenticado (${user.trim()}) em ${page.url()}`);
}

export async function logoutCrmPage(page: Page) {
  for (const url of CRM_LOGOUT_URLS) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await clickFirst(
      page,
      ['a:has-text("Sair")', 'button:has-text("Sair")', ".sair", "#sair", 'a[href*="sair"]'],
      { timeout: 1500 },
    );
  }
}

function withMeta(
  kind: VendorQueryKind,
  title: string,
  rows: VendorCrmRow[],
  monthLabel: string | null,
  note?: string,
): VendorQueryResult {
  return {
    kind,
    title,
    count: rows.length,
    rows,
    monthLabel,
    note,
    queriedAt: formatQueryTimestamp(),
  };
}

export async function runVendorCrmQuery(page: Page, kind: VendorQueryKind): Promise<VendorQueryResult> {
  const { label } = currentMonthParts();

  if (kind === "faturas") {
    return withMeta(kind, "Faturas de clientes", [], null, "Em breve — ainda vamos montar a busca de faturas.");
  }
  if (kind === "instalados") {
    return withMeta(kind, "Instalados", await collectBySearch(page, CRM_NIO_HISTORICO, "instalado", kind), label);
  }
  if (kind === "agendados") {
    return withMeta(kind, "Agendados", await collectBySearch(page, CRM_NIO_HISTORICO, "agendado", kind), label);
  }
  if (kind === "quebra") {
    return withMeta(
      kind,
      "Tratar quebra / Quebra em tratamento",
      await collectBySearch(page, CRM_NIO_HISTORICO, "quebra", kind),
      null,
    );
  }
  if (kind === "cancelados") {
    return withMeta(kind, "Cancelados", await collectBySearch(page, CRM_NIO_HISTORICO, "cancelado", kind), label);
  }
  return withMeta(kind, "Ag. biometria", await collectBySearch(page, CRM_NIO_PREVENDA, "biometria", kind), null);
}

export { parseCredentials } from "@/lib/vendor-helpers";
