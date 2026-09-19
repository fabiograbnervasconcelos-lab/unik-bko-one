import { chromium } from "playwright";
import fs from "node:fs";

const out = "/opt/cursor/artifacts";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.goto("https://uniktelecom.com.br/proadmin/login.php", {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
await page.locator('input[name="usuario"]').fill("usuario_invalido_teste");
await page.locator('input[type="password"]').fill("senha_errada_teste");
await Promise.all([
  page.waitForLoadState("domcontentloaded").catch(() => undefined),
  page.locator('button[type="submit"]').click(),
]);
await page.waitForTimeout(2000);
const stayed = page.url().includes("login.php");
await page.screenshot({ path: `${out}/crm-login-denied.png`, fullPage: true });
console.log(JSON.stringify({ stayedOnLogin: stayed, url: page.url() }));
await browser.close();
process.exit(stayed ? 0 : 1);
