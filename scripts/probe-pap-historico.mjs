/**
 * Probe PAP historico with Microsoft SSO.
 * Run: PAP_PASS='...' node scripts/probe-pap-historico.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "pap-probe");
fs.mkdirSync(OUT, { recursive: true });

const USER = process.env.PAP_USER || "TT833447@vtalcorp.onmicrosoft.com";
const PASS = process.env.PAP_PASS || "BfY79kbI4irLKzX";

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  console.log("shot", name, page.url());
}

async function dump(page, name) {
  const html = await page.content().catch(() => "");
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  const text = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text.slice(0, 80000));
  console.log("dump", name, "url=", page.url(), "chars=", text.length);
}

async function msLogin(page) {
  await page.goto("https://pap.niointernet.com.br/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("#i0116", { timeout: 30000 });
  await page.fill("#i0116", USER);
  await page.click("#idSIButton9");
  await page.waitForSelector("#i0118", { state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.fill("#i0118", PASS);
  await page.click("#idSIButton9");
  await page.waitForTimeout(4000);
  await shot(page, "01-after-pass");
  await dump(page, "01-after-pass");

  // Stay signed in / KMSI
  for (let i = 0; i < 3; i++) {
    const err = await page
      .locator("#passwordError")
      .innerText()
      .catch(() => "");
    if (err) {
      console.log("LOGIN_ERROR", err);
      return false;
    }
    if (!page.url().includes("microsoftonline") && !page.url().includes("login.microsoft")) {
      console.log("LOGIN_OK", page.url());
      return true;
    }
    const yes = page.locator("#idSIButton9, input[type='submit'][value='Sim'], input[type='submit'][value='Yes']").first();
    if (await yes.count()) {
      await yes.click().catch(() => undefined);
      await page.waitForTimeout(4000);
      await shot(page, `02-kmsi-${i}`);
      await dump(page, `02-kmsi-${i}`);
    } else {
      await page.waitForTimeout(3000);
    }
  }
  const ok =
    !page.url().includes("microsoftonline") && !page.url().includes("login.microsoft");
  console.log(ok ? "LOGIN_OK" : "LOGIN_FAIL", page.url());
  return ok;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
  });
  const page = await context.newPage();

  const logged = await msLogin(page);
  if (!logged) {
    await browser.close();
    process.exit(2);
  }

  await shot(page, "03-home");
  await dump(page, "03-home");

  await page.goto("https://pap.niointernet.com.br/administrativo/historico", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  await shot(page, "04-historico");
  await dump(page, "04-historico");

  const selects = await page.locator("select").evaluateAll((els) =>
    els.map((el) => ({
      name: el.name,
      id: el.id,
      className: el.className,
      options: [...el.options].slice(0, 40).map((o) => ({
        value: o.value,
        text: o.textContent?.trim(),
      })),
    })),
  );
  fs.writeFileSync(path.join(OUT, "selects.json"), JSON.stringify(selects, null, 2));
  console.log("selects", selects.length);

  const inputs = await page.locator("input").evaluateAll((els) =>
    els.slice(0, 60).map((el) => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      value: el.value,
      className: el.className,
    })),
  );
  fs.writeFileSync(path.join(OUT, "inputs.json"), JSON.stringify(inputs, null, 2));

  const buttons = await page.locator("button, a").evaluateAll((els) =>
    els
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent || "").trim().slice(0, 80),
        href: el.getAttribute("href"),
        className: el.className,
      }))
      .filter((b) => b.text)
      .slice(0, 80),
  );
  fs.writeFileSync(path.join(OUT, "buttons.json"), JSON.stringify(buttons, null, 2));

  // Try set tipo = interesse and dates 16/10/2026
  const saleSelect = page.locator("select").filter({ hasText: /interesse|venda|tipo/i }).first();
  if (await saleSelect.count()) {
    const opts = await saleSelect.locator("option").allTextContents();
    console.log("saleSelect opts", opts);
  }

  // Heuristic: find select with Interesse option
  const selectCount = await page.locator("select").count();
  for (let i = 0; i < selectCount; i++) {
    const sel = page.locator("select").nth(i);
    const texts = await sel.locator("option").allTextContents();
    const interest = texts.findIndex((t) => /interesse/i.test(t));
    if (interest >= 0) {
      const value = await sel.locator("option").nth(interest).getAttribute("value");
      console.log("Found interesse select index", i, "value", value, "text", texts[interest]);
      await sel.selectOption({ index: interest }).catch(async () => {
        await sel.selectOption(value || "").catch(() => undefined);
      });
    }
  }

  // Fill date fields looking like dd/mm/yyyy
  const dateLike = page.locator(
    'input[placeholder*="data" i], input[name*="data" i], input[id*="data" i], input[type="date"], input.form-control',
  );
  const dateCount = await dateLike.count();
  console.log("dateLike count", dateCount);
  for (let i = 0; i < Math.min(dateCount, 8); i++) {
    const el = dateLike.nth(i);
    const meta = await el.evaluate((node) => ({
      type: node.type,
      name: node.name,
      id: node.id,
      placeholder: node.placeholder,
      value: node.value,
    }));
    console.log("date field", i, meta);
  }

  // Fill first two text/date with 16/10/2026
  const filled = [];
  for (let i = 0; i < Math.min(dateCount, 6); i++) {
    const el = dateLike.nth(i);
    const type = await el.getAttribute("type");
    const ph = ((await el.getAttribute("placeholder")) || "").toLowerCase();
    const name = ((await el.getAttribute("name")) || "").toLowerCase();
    const id = ((await el.getAttribute("id")) || "").toLowerCase();
    const hint = `${ph} ${name} ${id}`;
    if (type === "date") {
      await el.fill("2026-10-16");
      filled.push({ i, value: "2026-10-16" });
    } else if (/data|inicio|fim|de|ate|até|from|to/.test(hint) || type === "text") {
      await el.fill("16/10/2026");
      filled.push({ i, value: "16/10/2026" });
    }
  }
  console.log("filled dates", filled);

  // Click search / filtrar / pesquisar
  const searchClicked = await page
    .locator(
      'button:has-text("Pesquisar"), button:has-text("Filtrar"), button:has-text("Buscar"), button:has-text("Consultar"), input[type="submit"]',
    )
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  console.log("searchClicked", searchClicked);
  await page.waitForTimeout(5000);
  await shot(page, "05-after-search");
  await dump(page, "05-after-search");

  // Table rows / detalhar
  const tableInfo = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("table")];
    return tables.slice(0, 3).map((table, idx) => ({
      idx,
      rows: table.querySelectorAll("tr").length,
      headers: [...table.querySelectorAll("th")].map((th) => th.textContent?.trim()).slice(0, 20),
      firstRow: table.querySelector("tbody tr")?.innerText?.slice(0, 300),
    }));
  });
  console.log("tables", JSON.stringify(tableInfo, null, 2));

  const detalhar = page.locator('button:has-text("Detalhar"), a:has-text("Detalhar"), [title*="Detalhar" i]').first();
  if (await detalhar.count()) {
    await detalhar.click();
    await page.waitForTimeout(3000);
    await shot(page, "06-detalhar");
    await dump(page, "06-detalhar");
  } else {
    console.log("No Detalhar button found");
    // try row click
    const row = page.locator("table tbody tr").first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(2000);
      await shot(page, "06-row-click");
      await dump(page, "06-row-click");
    }
  }

  // Look for Avançar
  const avancar = page.locator('button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Próximo"), button:has-text("Proximo")');
  const avancarCount = await avancar.count();
  console.log("avancar buttons", avancarCount);
  if (avancarCount) {
    await dump(page, "07-part1");
    await avancar.first().click();
    await page.waitForTimeout(2000);
    await shot(page, "08-part2");
    await dump(page, "08-part2");
    if (await avancar.count()) {
      await avancar.first().click();
      await page.waitForTimeout(2000);
      await shot(page, "09-plan");
      await dump(page, "09-plan");
    }
  }

  // Save storage state for later scraper reuse
  await context.storageState({ path: path.join(OUT, "storage-state.json") });
  console.log("Saved storage state");

  await browser.close();
  console.log("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
