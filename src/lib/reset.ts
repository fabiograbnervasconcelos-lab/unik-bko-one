import fs from "node:fs";
import path from "node:path";
import { clickFirst, launchBrowser, newContext } from "@/lib/browser";
import { SCREENSHOTS_DIR, ensureDataDirs } from "@/lib/paths";
import { clearSentAlerts } from "@/lib/sent-log";
import { getSnapshot, log, resetPanelKeepWhatsApp, setScreenshots } from "@/lib/store";

const CRM_LOGOUT = [
  "https://uniktelecom.com.br/proadmin/sair.php",
  "https://uniktelecom.com.br/proadmin/logout.php",
];

const GED_LOGOUT = [
  "https://ged360.niointernet.com.br/brprontopdv/autenticacao/sair",
  "https://ged360.niointernet.com.br/brprontopdv/sair",
];

function wipeScreenshots() {
  ensureDataDirs();
  if (fs.existsSync(SCREENSHOTS_DIR)) {
    for (const file of fs.readdirSync(SCREENSHOTS_DIR)) {
      fs.rmSync(path.join(SCREENSHOTS_DIR, file), { force: true });
    }
  }
  setScreenshots([]);
}

async function hitLogout(urls: string[]) {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    for (const url of urls) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
      await clickFirst(
        page,
        ['a:has-text("Sair")', 'button:has-text("Sair")', ".sair", "#sair", 'a[href*="sair"]'],
        { timeout: 2000 },
      );
    }
    await context.clearCookies().catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Zera a consulta e desloga CRM + GED. Não desconecta o WhatsApp. */
export async function resetCrmAndGedKeepWhatsApp() {
  resetPanelKeepWhatsApp();
  clearSentAlerts();
  wipeScreenshots();
  log("info", "Zerando consulta, prints e avisos. WhatsApp permanece conectado.");
  await Promise.allSettled([hitLogout(CRM_LOGOUT), hitLogout(GED_LOGOUT)]);
  log("info", "CRM e GED deslogados. A sessão do WhatsApp (QR) continua.");
  return getSnapshot();
}
