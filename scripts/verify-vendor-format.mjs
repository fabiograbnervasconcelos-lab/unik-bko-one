/**
 * One-off: login CRM + imprime 2 linhas no formato novo (não sobe senha pro git em follow-ups).
 * Uso: CRM_USER=... CRM_PASS=... node scripts/verify-vendor-format.mjs
 */
import { chromium } from "playwright";
import {
  buildRowFromText,
  filterRows,
  formatQueryResultMessages,
  formatQueryTimestamp,
} from "../src/lib/vendor-helpers.ts";

const user = process.env.CRM_USER;
const pass = process.env.CRM_PASS;
if (!user || !pass) {
  console.error("Defina CRM_USER e CRM_PASS");
  process.exit(1);
}

const HIST = "https://uniktelecom.com.br/proadmin/consultarHistoricos.php?active=historicos8&operadora=8";
const LOGIN = "https://uniktelecom.com.br/proadmin/login.php";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[name="usuario"]').fill(user);
await page.locator('input[type="password"]').fill(pass);
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(2500);
if (page.url().includes("login.php")) {
  console.error("LOGIN_DENIED");
  await browser.close();
  process.exit(2);
}

await page.goto(HIST, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);
const length = page.locator("select[name$='_length']").first();
if (await length.count()) await length.selectOption("100").catch(() => undefined);
await page.waitForTimeout(1000);
const search = page.locator(".dataTables_filter input").first();
await search.fill("agendado");
await page.waitForTimeout(2200);

const rows = page.locator("#table_default tbody tr");
const n = await rows.count();
const parsed = [];
for (let i = 0; i < Math.min(n, 15); i += 1) {
  const text = (await rows.nth(i).innerText()) || "";
  const cells = await rows.nth(i).locator("td").allInnerTexts().catch(() => []);
  const joined = cells.length ? cells.join("\n") : text;
  console.log("--- ROW RAW ---");
  console.log(joined.slice(0, 400));
  const row = buildRowFromText(joined, "agendados");
  if (row) parsed.push(row);
}
const filtered = filterRows("agendados", parsed);
const messages = formatQueryResultMessages({
  kind: "agendados",
  title: "Agendados",
  count: filtered.length,
  rows: filtered,
  monthLabel: "setembro de 2026",
  queriedAt: formatQueryTimestamp(),
});
console.log("\n===== FORMATTED =====\n");
console.log(messages.join("\n\n----\n\n"));
await browser.close();
