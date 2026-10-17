import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "pap-probe");
fs.mkdirSync(OUT, { recursive: true });
const USER = process.env.PAP_USER || "TT829944@vtalcorp.onmicrosoft.com";
const PASS = process.env.PAP_PASS || "Niosuper001one";

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log("shot", name, "->", page.url().slice(0, 100));
}

async function msLogin(page) {
  console.log("start login, url", page.url());
  // Email step
  await page.waitForSelector("#i0116", { timeout: 30000 });
  await page.fill("#i0116", USER);
  await page.click("#idSIButton9");
  // Password step
  await page.waitForSelector("#i0118:not(.moveOffScreen)", { timeout: 30000 }).catch(() =>
    page.waitForSelector("#i0118", { state: "visible", timeout: 30000 }),
  );
  await page.waitForTimeout(1000);
  await page.fill("#i0118", "");
  await page.fill("#i0118", PASS);
  await page.click("#idSIButton9");
  await page.waitForTimeout(3000);

  // KMSI / stay signed in
  for (let i = 0; i < 5; i++) {
    const url = page.url();
    console.log("post-auth url", i, url.slice(0, 120));
    if (url.includes("pap.niointernet.com.br") && !url.includes("microsoft")) {
      return true;
    }
    const err = await page.locator("#passwordError").innerText().catch(() => "");
    if (err) {
      console.log("password error", err);
      return false;
    }
    // Click Sim / Yes / Entrar on KMSI if present
    const btn = page.locator("#idSIButton9");
    if (await btn.count()) {
      const val = await btn.getAttribute("value").catch(() => "");
      console.log("clicking idSIButton9 value=", val);
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(3500);
      continue;
    }
    await page.waitForTimeout(2000);
  }
  return page.url().includes("pap.niointernet.com.br");
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
  });
  const page = await context.newPage();

  const apiHits = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("pap-api.niointernet.com.br")) {
      apiHits.push({
        kind: "req",
        method: req.method(),
        url,
        postData: (req.postData() || "").slice(0, 2000),
        headers: req.headers(),
      });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("pap-api.niointernet.com.br")) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 8000);
      } catch {}
      apiHits.push({ kind: "res", status: res.status(), url, body });
      console.log("API", res.status(), res.request().method(), url.slice(0, 140));
    }
  });

  await page.goto("https://pap.niointernet.com.br/", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(2000);
  await shot(page, "a01-start");

  // May already redirect to MS login
  if (page.url().includes("microsoftonline") || (await page.locator("#i0116").count())) {
    const ok = await msLogin(page);
    console.log("login ok?", ok, page.url());
    if (!ok) {
      await shot(page, "a01-fail");
      await browser.close();
      process.exit(2);
    }
  }

  await page.waitForTimeout(3000);
  await shot(page, "a02-after-login");

  // Ensure historico
  if (!page.url().includes("/administrativo/historico")) {
    await page.goto("https://pap.niointernet.com.br/administrativo/historico", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);
  }
  await shot(page, "a03-historico");
  const text = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "a03-historico.txt"), text);
  console.log(text.slice(0, 800));

  // Wait for Filtros button and click with force, or open drawer
  await page.waitForSelector("text=Filtros", { timeout: 20000 }).catch(() => undefined);

  // If drawer already open, use it; else open
  let drawerOpen = (await page.locator(".MuiDrawer-paper").count()) > 0;
  console.log("drawerOpen", drawerOpen);
  if (!drawerOpen) {
    await page.locator(".titulo-filtro, text=Filtros").first().click({ force: true, timeout: 10000 });
    await page.waitForTimeout(1500);
    drawerOpen = (await page.locator(".MuiDrawer-paper").count()) > 0;
  }
  console.log("drawerOpen after", drawerOpen);
  await shot(page, "a04-drawer");

  const drawerText = await page.locator(".MuiDrawer-paper").innerText().catch(() => "");
  fs.writeFileSync(path.join(OUT, "a04-drawer.txt"), drawerText);
  console.log("DRAWER:\n", drawerText.slice(0, 4000));

  const drawerHtml = await page.locator(".MuiDrawer-paper").innerHTML().catch(() => "");
  fs.writeFileSync(path.join(OUT, "a04-drawer.html"), drawerHtml.slice(0, 300000));

  // Enumerate controls
  const controls = await page.evaluate(() => {
    const root = document.querySelector(".MuiDrawer-paper") || document.body;
    return [...root.querySelectorAll("input, select, textarea, [role='combobox'], button, .MuiSelect-select")].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          type: el.getAttribute("type") || "",
          placeholder: el.getAttribute("placeholder") || "",
          name: el.getAttribute("name") || "",
          id: el.id,
          className: String(el.className).slice(0, 120),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
          value: "value" in el ? String(el.value || "") : "",
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      },
    );
  });
  fs.writeFileSync(path.join(OUT, "a04-controls.json"), JSON.stringify(controls, null, 2));
  console.log("controls", JSON.stringify(controls, null, 2));

  // Select tipo Interesse
  const tipoLabel = page.locator(".MuiDrawer-paper").getByText(/tipo/i).first();
  if (await tipoLabel.count()) {
    console.log("tipo label", await tipoLabel.innerText());
  }

  // Click all MuiSelect in drawer
  const selects = page.locator(".MuiDrawer-paper .MuiSelect-select, .MuiDrawer-paper [role=combobox]");
  console.log("selects", await selects.count());
  for (let i = 0; i < (await selects.count()); i++) {
    await selects.nth(i).click({ force: true });
    await page.waitForTimeout(600);
    const opts = await page.locator("ul[role=listbox] li, .MuiMenuItem-root, [role=option]").allTextContents();
    console.log("options", i, opts);
    const hit = page.locator("ul[role=listbox] li, .MuiMenuItem-root, [role=option]").filter({ hasText: /interesse/i }).first();
    if (await hit.count()) {
      await hit.click({ force: true });
      console.log("chose interesse");
      await page.waitForTimeout(400);
    } else {
      await page.keyboard.press("Escape");
    }
  }

  // Fill dates
  const inputs = page.locator(".MuiDrawer-paper input");
  for (let i = 0; i < (await inputs.count()); i++) {
    const el = inputs.nth(i);
    const meta = await el.evaluate((n) => ({
      type: n.type,
      ph: n.placeholder,
      name: n.name,
      readonly: n.readOnly,
      value: n.value,
    }));
    console.log("input", i, meta);
    if (meta.type === "date") {
      await el.fill("2026-10-16");
    } else if (!meta.readonly) {
      // try date pattern for first two text inputs that look empty
      await el.click({ force: true });
      await el.fill("16/10/2026");
      console.log("filled", i);
    } else {
      // readonly datepicker - click then type
      await el.click({ force: true });
      await page.waitForTimeout(400);
      await el.press("Control+A").catch(() => undefined);
      await page.keyboard.type("16/10/2026", { delay: 40 });
      await page.keyboard.press("Enter");
      console.log("typed readonly", i);
    }
  }
  await shot(page, "a05-filled");

  // Submit filter
  const submit = page.locator(".MuiDrawer-paper button").filter({ hasText: /filtrar|buscar|pesquisar|aplicar/i }).first();
  if (await submit.count()) {
    console.log("submit", await submit.innerText());
    await submit.click({ force: true });
  } else {
    const allBtns = await page.locator(".MuiDrawer-paper button").allTextContents();
    console.log("all drawer buttons", allBtns);
    // often the primary is last
    const primary = page.locator(".MuiDrawer-paper button.MuiButton-contained, .MuiDrawer-paper button").last();
    if (await primary.count()) {
      console.log("click primary", await primary.innerText());
      await primary.click({ force: true });
    }
  }

  await page.waitForTimeout(7000);
  await shot(page, "a06-results");
  const resultText = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "a06-results.txt"), resultText);
  console.log(resultText.slice(0, 3000));

  fs.writeFileSync(path.join(OUT, "a-apis.json"), JSON.stringify(apiHits, null, 2));
  await context.storageState({ path: path.join(OUT, "storage-state.json") });
  console.log("cookies", (await context.cookies()).map((c) => c.name));
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
