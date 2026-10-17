import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "pap-probe");
fs.mkdirSync(OUT, { recursive: true });
const USER = process.env.PAP_USER || "TT829944@vtalcorp.onmicrosoft.com";
const PASS = process.env.PAP_PASS || "Niosuper001one";

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log("shot", name);
}

async function login(page) {
  await page.goto("https://pap.niointernet.com.br/", { waitUntil: "domcontentloaded", timeout: 60000 });
  if (await page.locator("#i0116").count()) {
    await page.fill("#i0116", USER);
    await page.click("#idSIButton9");
    await page.waitForSelector("#i0118", { state: "visible", timeout: 20000 });
    await page.waitForTimeout(700);
    await page.fill("#i0118", PASS);
    await page.click("#idSIButton9");
    await page.waitForTimeout(2500);
    if (await page.locator("#idSIButton9").count()) await page.click("#idSIButton9").catch(() => undefined);
    await page.waitForURL(/pap\.niointernet/, { timeout: 60000 }).catch(() => undefined);
  }
  await page.goto("https://pap.niointernet.com.br/administrativo/historico", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(4000);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage();

  const apiHits = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (
      /api|historico|pedido|venda|filtro|search|consulta|gateway/i.test(url) &&
      !/\.(js|css|png|jpg|svg|woff2?)(\?|$)/i.test(url)
    ) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 4000);
      } catch {}
      apiHits.push({ status: res.status(), url, body });
    }
  });

  await login(page);
  await shot(page, "d01-loaded");

  // Close any blocking drawer first? Or inspect it.
  const drawer = page.locator(".MuiDrawer-root, .drawer, [role='presentation'].MuiDrawer-root").first();
  console.log("drawer count", await page.locator(".MuiDrawer-root").count());

  // Dump drawer text
  const drawerText = await page.locator(".MuiDrawer-paper, .MuiDrawer-root").innerText().catch(() => "");
  fs.writeFileSync(path.join(OUT, "d01-drawer.txt"), drawerText);
  console.log("drawer text:\n", drawerText.slice(0, 3000));

  // All visible inputs inside drawer
  const inputs = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("input, select, textarea, [role='combobox'], [role='button']")];
    return nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        name: el.getAttribute("name") || "",
        id: el.id,
        placeholder: el.getAttribute("placeholder") || "",
        value: "value" in el ? String(el.value || "") : "",
        className: String(el.className).slice(0, 160),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        aria: el.getAttribute("aria-label") || "",
        role: el.getAttribute("role") || "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }).filter((n) => n.w > 0 && n.h > 0);
  });
  fs.writeFileSync(path.join(OUT, "d01-inputs.json"), JSON.stringify(inputs, null, 2));
  console.log("visible controls", inputs.length);
  console.log(JSON.stringify(inputs.slice(0, 40), null, 2));

  // Full HTML of drawer paper
  const drawerHtml = await page.locator(".MuiDrawer-paper").innerHTML().catch(() => "");
  fs.writeFileSync(path.join(OUT, "d01-drawer.html"), drawerHtml.slice(0, 200000));
  console.log("drawer html len", drawerHtml.length);

  // Labels in drawer
  const labels = await page.locator(".MuiDrawer-paper label, .MuiDrawer-paper .titulo, .MuiDrawer-paper p, .MuiDrawer-paper span").allTextContents();
  console.log("label texts", [...new Set(labels.map((t) => t.trim()).filter((t) => t && t.length < 80))].slice(0, 80));

  // Try select Interesse in tipo
  // Look for MUI Select
  const muiSelects = page.locator(".MuiDrawer-paper .MuiSelect-select, .MuiDrawer-paper [role='combobox'], .MuiDrawer-paper .MuiInputBase-root");
  console.log("mui selects/inputs roots", await muiSelects.count());

  // Click each combobox-like and list options
  const combos = page.locator(".MuiDrawer-paper [role='combobox'], .MuiDrawer-paper .MuiSelect-select");
  const comboCount = await combos.count();
  console.log("combos", comboCount);
  for (let i = 0; i < comboCount; i++) {
    const c = combos.nth(i);
    await c.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(700);
    await shot(page, `d02-combo-${i}`);
    const opts = await page.locator("[role='option'], .MuiMenuItem-root, li.MuiMenuItem-root").allTextContents();
    console.log(`combo ${i} options`, opts.slice(0, 30));
    const interesse = page.locator("[role='option'], .MuiMenuItem-root").filter({ hasText: /^interesse$/i }).first();
    if (await interesse.count()) {
      await interesse.click({ force: true });
      console.log("selected Interesse on combo", i);
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press("Escape");
    }
  }

  // Fill date fields
  const dateFields = page.locator(".MuiDrawer-paper input");
  const dateCount = await dateFields.count();
  console.log("drawer inputs", dateCount);
  for (let i = 0; i < dateCount; i++) {
    const el = dateFields.nth(i);
    const meta = await el.evaluate((node) => ({
      type: node.type,
      placeholder: node.placeholder,
      name: node.name,
      id: node.id,
      value: node.value,
      readOnly: node.readOnly,
    }));
    console.log("input", i, meta);
  }

  // Set dates 16/10/2026 - try typing into date-like inputs
  for (let i = 0; i < dateCount; i++) {
    const el = dateFields.nth(i);
    const type = await el.getAttribute("type");
    const ph = (await el.getAttribute("placeholder")) || "";
    if (type === "date") {
      await el.fill("2026-10-16");
    } else if (/data|\/|dd/i.test(ph) || type === "text" || type === "tel") {
      await el.click({ force: true });
      await el.fill("");
      await el.type("16/10/2026", { delay: 30 });
      await page.keyboard.press("Tab");
      console.log("typed date into", i, ph || type);
    }
  }
  await shot(page, "d03-dates-filled");

  // Click Filtrar / Buscar / Aplicar inside drawer
  const action = page.locator(".MuiDrawer-paper button, .MuiDrawer-root button").filter({
    hasText: /filtrar|buscar|pesquisar|aplicar|consultar/i,
  }).first();
  if (await action.count()) {
    console.log("action btn", await action.innerText());
    await action.click({ force: true });
  } else {
    // any green/primary button
    const buttons = await page.locator(".MuiDrawer-paper button").allTextContents();
    console.log("drawer buttons", buttons);
    const last = page.locator(".MuiDrawer-paper button").last();
    if (await last.count()) {
      console.log("clicking last drawer button", await last.innerText());
      await last.click({ force: true });
    }
  }

  await page.waitForTimeout(6000);
  await shot(page, "d04-after-filter");
  const bodyText = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "d04-body.txt"), bodyText.slice(0, 100000));
  console.log("body after filter:\n", bodyText.slice(0, 2500));

  // Look for Detalhar
  const detalhar = page.locator("button, a, span").filter({ hasText: /detalhar/i });
  console.log("detalhar count", await detalhar.count());
  if (await detalhar.count()) {
    await detalhar.first().click({ force: true });
    await page.waitForTimeout(3000);
    await shot(page, "d05-detalhar");
    const detailText = await page.locator("body").innerText();
    fs.writeFileSync(path.join(OUT, "d05-detalhar.txt"), detailText.slice(0, 100000));
    console.log("detalhe:\n", detailText.slice(0, 3000));

    // Avançar steps
    for (let step = 1; step <= 3; step++) {
      const avancar = page.locator("button").filter({ hasText: /avan[cç]ar|pr[oó]ximo/i }).first();
      if (!(await avancar.count())) break;
      console.log("click avancar step", step);
      await avancar.click({ force: true });
      await page.waitForTimeout(2000);
      await shot(page, `d06-step-${step}`);
      const t = await page.locator("body").innerText();
      fs.writeFileSync(path.join(OUT, `d06-step-${step}.txt`), t.slice(0, 80000));
      console.log(`step ${step}:\n`, t.slice(0, 2000));
    }
  }

  // Pagination arrow
  const nextPage = page.locator("button, [aria-label*='next' i], [aria-label*='próxim' i], .MuiPagination-root button").last();
  console.log("pagination-ish", await page.locator(".MuiPagination-root, [aria-label*='pagination' i]").count());

  fs.writeFileSync(path.join(OUT, "d-apis.json"), JSON.stringify(apiHits, null, 2));
  console.log("API hits", apiHits.length);
  for (const a of apiHits.slice(0, 30)) console.log(a.status, a.url.slice(0, 160));

  await context.storageState({ path: path.join(OUT, "storage-state.json") });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
