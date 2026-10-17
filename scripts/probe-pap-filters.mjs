/**
 * After login, open Filtros on historico and map the form.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "pap-probe");
fs.mkdirSync(OUT, { recursive: true });

const USER = process.env.PAP_USER || "TT829944@vtalcorp.onmicrosoft.com";
const PASS = process.env.PAP_PASS || "Niosuper001one";
const STATE = path.join(OUT, "storage-state.json");

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);
  console.log("shot", name, page.url());
}

async function dump(page, name) {
  const html = await page.content().catch(() => "");
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  const text = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text.slice(0, 100000));
  console.log("dump", name, "chars", text.length);
}

async function login(page) {
  await page.goto("https://pap.niointernet.com.br/", { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("microsoftonline") || (await page.locator("#i0116").count())) {
    await page.waitForSelector("#i0116", { timeout: 20000 });
    await page.fill("#i0116", USER);
    await page.click("#idSIButton9");
    await page.waitForSelector("#i0118", { state: "visible", timeout: 20000 });
    await page.waitForTimeout(800);
    await page.fill("#i0118", PASS);
    await page.click("#idSIButton9");
    await page.waitForTimeout(3000);
    const yes = page.locator("#idSIButton9").first();
    if (await yes.count()) await yes.click().catch(() => undefined);
    await page.waitForURL(/pap\.niointernet\.com\.br/, { timeout: 60000 }).catch(() => undefined);
  }
  await page.goto("https://pap.niointernet.com.br/administrativo/historico", {
    waitUntil: "networkidle",
    timeout: 60000,
  }).catch(() => page.goto("https://pap.niointernet.com.br/administrativo/historico", { waitUntil: "domcontentloaded" }));
  await page.waitForTimeout(3000);
}

async function describeDom(page, label) {
  const info = await page.evaluate(() => {
    const visible = (el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
    };
    const inputs = [...document.querySelectorAll("input, select, textarea")].filter(visible).map((el) => ({
      tag: el.tagName,
      type: el.type || "",
      name: el.name,
      id: el.id,
      placeholder: el.placeholder || "",
      value: el.value || "",
      className: String(el.className).slice(0, 120),
      aria: el.getAttribute("aria-label") || "",
      role: el.getAttribute("role") || "",
    }));
    const buttons = [...document.querySelectorAll("button, [role='button'], a")].filter(visible)
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 100);
    const labels = [...document.querySelectorAll("label, .label, mat-label, span")].filter(visible)
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 1 && t.length < 60)
      .slice(0, 120);
    return { inputs, buttons: [...new Set(buttons)], labels: [...new Set(labels)] };
  });
  fs.writeFileSync(path.join(OUT, `${label}-dom.json`), JSON.stringify(info, null, 2));
  console.log(label, "inputs", info.inputs.length, "buttons", info.buttons.length);
  return info;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    storageState: fs.existsSync(STATE) ? STATE : undefined,
  });
  const page = await context.newPage();

  // Capture XHR for historico APIs
  const apis = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (/historico|pedido|venda|interesse|filtro|search|consulta/i.test(url) && !/\.(js|css|png|jpg|woff)/i.test(url)) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 2000);
      } catch {}
      apis.push({ url, status: res.status(), body });
    }
  });

  await login(page);
  await shot(page, "f01-historico");
  await dump(page, "f01-historico");
  await describeDom(page, "f01");

  // Click Filtros
  const filtros = page.getByText("Filtros", { exact: false }).first();
  await filtros.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  await shot(page, "f02-filtros");
  await dump(page, "f02-filtros");
  const dom = await describeDom(page, "f02");
  console.log("buttons sample", dom.buttons.slice(0, 40));
  console.log("labels sample", dom.labels.slice(0, 50));
  console.log("inputs", JSON.stringify(dom.inputs, null, 2));

  // Try to find tipo de venda / interesse
  // Common patterns: mat-select, ng-select, custom dropdown
  const tipoCandidates = [
    page.getByText(/tipo de venda/i),
    page.getByText(/^Tipo$/i),
    page.locator("text=Tipo de venda"),
    page.locator("text=Tipo Venda"),
  ];
  for (const c of tipoCandidates) {
    if (await c.count()) {
      console.log("found tipo candidate", await c.first().innerText().catch(() => ""));
      await c.first().click().catch(() => undefined);
      await page.waitForTimeout(1000);
      await shot(page, "f03-tipo-open");
      break;
    }
  }

  // Click any dropdown that might be sale type
  const dropdowns = page.locator(
    "[role='combobox'], .mat-select, .mat-mdc-select, .ng-select, .p-dropdown, .ant-select, select",
  );
  console.log("dropdown count", await dropdowns.count());
  for (let i = 0; i < Math.min(await dropdowns.count(), 8); i++) {
    const d = dropdowns.nth(i);
    const box = await d.boundingBox().catch(() => null);
    console.log("dropdown", i, box);
    await d.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await shot(page, `f04-dd-${i}`);
    const options = await page.locator("[role='option'], .mat-option, .ng-option, .p-dropdown-item, li").allTextContents();
    const interesting = options.filter((t) => /interesse|venda|pré|pre/i.test(t));
    if (interesting.length) {
      console.log("interesting options", interesting);
      const interesse = page.locator("[role='option'], .mat-option, .ng-option, .p-dropdown-item, li").filter({ hasText: /interesse/i }).first();
      if (await interesse.count()) {
        await interesse.click();
        await page.waitForTimeout(500);
        console.log("selected interesse");
      }
    } else {
      // close by Escape
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  // Fill dates - look for date inputs after filter open
  const allInputs = await page.locator("input").evaluateAll((els) =>
    els.map((el) => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      value: el.value,
      aria: el.getAttribute("aria-label"),
      className: String(el.className).slice(0, 100),
    })),
  );
  fs.writeFileSync(path.join(OUT, "f05-all-inputs.json"), JSON.stringify(allInputs, null, 2));
  console.log("all inputs", allInputs.length, allInputs.slice(0, 30));

  // Try filling date fields that look like dd/mm/yyyy
  for (const inp of allInputs) {
    const hint = `${inp.placeholder} ${inp.name} ${inp.id} ${inp.aria}`.toLowerCase();
    if (/data|inicio|início|fim|de|até|ate|periodo/.test(hint) || inp.type === "date") {
      console.log("date-ish", inp);
    }
  }

  // Heuristic fill: find two date fields and set 16/10/2026
  const dateInputs = page.locator('input[type="date"], input[placeholder*="/"], input[mask], input[formcontrolname*="data" i]');
  console.log("dateInputs", await dateInputs.count());

  // Also try clicking calendar icons / datepicker fields by label
  for (const label of ["Data início", "Data inicio", "Data fim", "De", "Até", "Periodo", "Período"]) {
    const loc = page.getByText(label, { exact: false }).first();
    if (await loc.count()) {
      console.log("label found", label);
      const nearby = loc.locator("xpath=ancestor::*[self::div or self::mat-form-field or self::label][1]//input").first();
      if (await nearby.count()) {
        await nearby.click();
        await nearby.fill("16/10/2026");
        console.log("filled near", label);
      }
    }
  }

  // Click Aplicar / Pesquisar / Buscar / Filtrar
  for (const text of ["Aplicar", "Pesquisar", "Buscar", "Filtrar", "Consultar", "OK"]) {
    const btn = page.getByRole("button", { name: new RegExp(`^${text}$`, "i") }).first();
    if (await btn.count()) {
      console.log("clicking", text);
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(4000);
      await shot(page, `f06-after-${text.toLowerCase()}`);
      await dump(page, `f06-after-${text.toLowerCase()}`);
      break;
    }
  }

  // Also try text match not role
  const apply = page.locator("button, [role='button']").filter({ hasText: /aplicar|pesquisar|buscar|filtrar/i }).first();
  if (await apply.count()) {
    console.log("apply text", await apply.innerText());
    await apply.click().catch(() => undefined);
    await page.waitForTimeout(5000);
    await shot(page, "f07-after-apply");
    await dump(page, "f07-after-apply");
  }

  await describeDom(page, "f08-result");
  const tables = await page.evaluate(() =>
    [...document.querySelectorAll("table, .p-datatable, cdk-table, mat-table, [role='table'], .ag-root")].map((el) => ({
      tag: el.tagName,
      className: String(el.className).slice(0, 120),
      text: el.innerText?.slice(0, 500),
    })),
  );
  console.log("tables", JSON.stringify(tables, null, 2));
  fs.writeFileSync(path.join(OUT, "apis.json"), JSON.stringify(apis, null, 2));
  console.log("apis captured", apis.length);
  apis.slice(0, 20).forEach((a) => console.log(a.status, a.url.slice(0, 140)));

  await context.storageState({ path: STATE });
  await browser.close();
  console.log("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
