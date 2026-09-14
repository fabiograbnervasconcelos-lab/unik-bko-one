import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
export const WHATSAPP_AUTH_DIR = path.join(DATA_DIR, "whatsapp-auth");
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, WHATSAPP_AUTH_DIR, SCREENSHOTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
