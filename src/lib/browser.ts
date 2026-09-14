import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SCREENSHOTS_DIR, ensureDataDirs } from "@/lib/paths";
import { log, setScreenshots, getSnapshot } from "@/lib/store";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

export async function launchBrowser(): Promise<Browser> {
  const executablePath = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
}

export async function screenshot(page: Page, name: string) {
  ensureDataDirs();
  const file = `${name.replace(/[^a-z0-9-]/gi, "-")}.png`;
  const fullPath = path.join(SCREENSHOTS_DIR, file);
  await page.screenshot({ path: fullPath, fullPage: true }).catch(() => undefined);
  const next = Array.from(new Set([...getSnapshot().screenshots, file]));
  setScreenshots(next);
  log("info", `Print salvo: ${file}`);
  return file;
}

export async function clickFirst(
  page: Page,
  selectors: string[],
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 2500;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

export async function fillFirst(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
}

export async function visibleText(page: Page) {
  const chunks: string[] = [];
  for (const frame of page.frames()) {
    try {
      chunks.push(await frame.locator("body").innerText({ timeout: 5000 }));
    } catch {
      continue;
    }
  }
  return chunks.join("\n");
}
