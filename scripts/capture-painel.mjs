import { chromium } from "playwright";
import fs from "node:fs";

const out = "/opt/cursor/artifacts";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://127.0.0.1:43147/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/painel-whatsapp-qr.png`, fullPage: false });

const status = await page.goto("http://127.0.0.1:43147/api/status", {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
const json = await status.json();
fs.writeFileSync(
  `${out}/api-status-vendorBot.json`,
  JSON.stringify(
    {
      whatsapp: json.whatsapp,
      hasQr: json.hasQr,
      vendorBot: json.vendorBot,
      step: json.step,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      whatsapp: json.whatsapp,
      hasQr: json.hasQr,
      vendorBot: json.vendorBot,
      saved: ["painel-whatsapp-qr.png", "api-status-vendorBot.json"],
    },
    null,
    2,
  ),
);
await browser.close();
