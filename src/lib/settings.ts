import fs from "node:fs";
import { ensureDataDirs, SETTINGS_PATH } from "@/lib/paths";

export type AppSettings = {
  crmUser: string;
  crmPass: string;
  gedUser: string;
  gedPass: string;
  gedDomain: "1" | "2";
  groupBko: string;
  groupGerentes: string;
  extraCpfs: string;
};

const DEFAULTS: AppSettings = {
  crmUser: process.env.CRM_USER ?? "",
  crmPass: process.env.CRM_PASS ?? "",
  gedUser: process.env.GED_USER ?? "",
  gedPass: process.env.GED_PASS ?? "",
  gedDomain: process.env.GED_DOMAIN === "2" ? "2" : "1",
  groupBko: process.env.WHATSAPP_GROUP_BKO ?? "bko one urgente",
  groupGerentes: process.env.WHATSAPP_GROUP_GERENTES ?? "gerentes one",
  extraCpfs: "",
};

export function loadSettings(): AppSettings {
  ensureDataDirs();
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { ...DEFAULTS };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as Partial<AppSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      gedDomain: parsed.gedDomain === "2" ? "2" : "1",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(input: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...input,
    gedDomain: input.gedDomain === "2" ? "2" : input.gedDomain === "1" ? "1" : current.gedDomain,
  };
  ensureDataDirs();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}
