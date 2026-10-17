/**
 * Human-like PAP historico: one action at a time, slow delays, UI only.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "pap-probe");
fs.mkdirSync(OUT, { recursive: true });
const USER = process.env.PAP_USER || "TT829944@vtalcorp.onmicrosoft.com";
const PASS = process.env.PAP_PASS || "Niosuper001one";
const DATE_FROM = process.env.PAP_DATE_FROM || "16/10/2026";
const DATE_TO = process.env.PAP_DATE_TO || "16/10/2026";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = async (a = 900, b = 1800) => sleep(a + Math.floor(Math.random() * (b - a)));

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);
  console.log("shot", name);
}

async function login(page) {
  await page.goto("https://pap.niointernet.com.br/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#i0116", { timeout: 30000 });
  await pause(600, 1000);
  await page.fill("#i0116", USER);
  await pause(400, 700);
  await page.click("#idSIButton9");
  await page.waitForSelector("#i0118", { state: "visible", timeout: 30000 });
  await pause(800, 1300);
  await page.fill("#i0118", PASS);
  await pause(400, 700);
  await page.click("#idSIButton9");
  await sleep(2500);
  for (let i = 0; i < 5; i++) {
    if (page.url().includes("pap.niointernet.com.br") && !page.url().includes("microsoft")) break;
    if (await page.locator("#idSIButton9").count()) {
      await pause(500, 900);
      await page.click("#idSIButton9");
      await sleep(3000);
    } else await sleep(1500);
  }
  await page.waitForURL(/pap\.niointernet\.com\.br/, { timeout: 60000 });
  await pause(2000, 3000);
  if (!page.url().includes("/historico")) {
    await page.goto("https://pap.niointernet.com.br/administrativo/historico", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await pause(2500, 3500);
  }
  console.log("OK login", page.url());
}

async function ensureDrawer(page) {
  if (await page.locator(".MuiDrawer-paper").isVisible().catch(() => false)) return;
  await page.locator(".titulo-filtro").click({ force: true });
  await page.waitForSelector(".MuiDrawer-paper", { state: "visible", timeout: 15000 });
  await pause(700, 1200);
}

async function setTipoInteresse(page) {
  await ensureDrawer(page);
  // Click the visible value/control of Tipo (first filter-select)
  const control = page.locator(".MuiDrawer-paper .filter-select-pdv .css-2khbr9-control, .MuiDrawer-paper .filter-select .css-2khbr9-control").first();
  if (await control.count()) {
    await control.click({ force: true });
  } else {
    await page.locator(".MuiDrawer-paper input[id^='react-select-']").first().click({ force: true });
  }
  await pause(500, 900);
  await page.keyboard.type("Interesse", { delay: 70 });
  await pause(600, 1000);
  // Click the menu option if present (portal)
  const opt = page.locator("#react-select-8-option-1, div[id*='react-select'][id*='option']").filter({ hasText: /^interesse$/i }).first();
  if (await opt.count()) {
    await opt.click({ force: true });
  } else {
    await page.keyboard.press("Enter");
  }
  await pause(800, 1400);
  const txt = await page.locator(".MuiDrawer-paper").innerText();
  console.log("drawer after tipo:\n", txt);
  if (!/interesse/i.test(txt)) throw new Error("Tipo Interesse not selected");
}

async function setDateField(page, label, dateStr) {
  // label is "De" or "Até"
  const field = page.locator(".MuiDrawer-paper .MuiTextField-root").filter({ hasText: label }).locator("input").first();
  await field.waitFor({ state: "visible", timeout: 10000 });
  await field.click({ force: true });
  await pause(400, 700);
  await page.keyboard.press("Control+a");
  await pause(150, 300);
  await page.keyboard.press("Backspace");
  await pause(200, 400);
  // fill via fill() then fire input events
  await field.fill(dateStr);
  await field.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }, dateStr);
  await pause(500, 900);
  console.log("date", label, "=>", await field.inputValue());
}

async function clickFiltrar(page) {
  await ensureDrawer(page);
  const btn = page.locator(".MuiDrawer-paper button.btn-filters-new");
  await btn.waitFor({ state: "visible" });
  // wait until enabled
  for (let i = 0; i < 20; i++) {
    const disabled = await btn.isDisabled();
    if (!disabled) break;
    await sleep(500);
  }
  if (await btn.isDisabled()) {
    console.log("Filtrar still disabled, drawer:\n", await page.locator(".MuiDrawer-paper").innerText());
  }
  await pause(700, 1200);
  await btn.click({ force: true });
  console.log("Filtrar clicked");
  await sleep(6000);
  await pause(1500, 2500);
}

async function closeDrawer(page) {
  const x = page.locator(".MuiDrawer-paper button#drawer-filter").first();
  if (await x.count()) {
    await pause(400, 700);
    await x.click({ force: true }).catch(() => undefined);
    await pause(800, 1200);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await pause(500, 800);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage();

  page.on("response", async (res) => {
    if (!res.url().includes("/api/portal/vendas")) return;
    const text = await res.text().catch(() => "");
    console.log("VENDAS", res.status(), res.url());
    console.log("BODY", text.slice(0, 500));
    fs.writeFileSync(path.join(OUT, "last-vendas-url.txt"), res.url());
    fs.writeFileSync(path.join(OUT, "last-vendas-response.json"), text);
  });

  await login(page);
  await shot(page, "hum01");

  await ensureDrawer(page);
  await shot(page, "hum02-drawer");
  await setTipoInteresse(page);
  await pause(1000, 1600);

  // Keep Status Primário as auto Minhas Pendências for now (PAP default for Interesse)
  await setDateField(page, "De", DATE_FROM);
  await setDateField(page, "Até", DATE_TO);
  await shot(page, "hum03-dates");
  console.log("ready:\n", await page.locator(".MuiDrawer-paper").innerText());

  await clickFiltrar(page);
  await shot(page, "hum04-filtered");
  await closeDrawer(page);
  await shot(page, "hum05-list");
  const body = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "hum05-list.txt"), body);
  console.log("LIST:\n", body.slice(0, 5000));

  // If list has Detalhar, open first client slowly
  const det = page.locator("button, a").filter({ hasText: /^detalhar$/i });
  console.log("detalhar count", await det.count());
  if (await det.count()) {
    await pause(1200, 2000);
    await det.first().click({ force: true });
    await sleep(3000);
    await pause(1200, 2000);
    await shot(page, "hum06-part1");
    const p1 = await page.locator("body").innerText();
    fs.writeFileSync(path.join(OUT, "hum06-part1.txt"), p1);
    console.log("PART1:\n", p1.slice(0, 2500));

    for (const step of ["part2", "plan"]) {
      const av = page.locator("button").filter({ hasText: /avan[cç]ar/i }).first();
      if (!(await av.count())) break;
      await pause(1200, 2200);
      await av.click({ force: true });
      await sleep(2500);
      await pause(1000, 1800);
      await shot(page, `hum07-${step}`);
      const t = await page.locator("body").innerText();
      fs.writeFileSync(path.join(OUT, `hum07-${step}.txt`), t);
      console.log(step.toUpperCase() + ":\n", t.slice(0, 2500));
    }
  } else {
    // Dump DOM hints for list structure
    const html = await page.content();
    fs.writeFileSync(path.join(OUT, "hum05-page.html"), html.slice(0, 400000));
    console.log("No Detalhar — saved page html");
  }

  await context.storageState({ path: path.join(OUT, "storage-state.json") });
  await browser.close();
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
