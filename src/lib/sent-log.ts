import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { onlyDigits } from "@/lib/text";

const SENT_PATH = path.join(DATA_DIR, "sent-alerts.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SentRecord = {
  cpf: string;
  result: string;
  sentAt: string;
};

function loadAll(): SentRecord[] {
  ensureDataDirs();
  if (!fs.existsSync(SENT_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(SENT_PATH, "utf8")) as SentRecord[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((row) => Date.parse(row.sentAt) >= cutoff);
  } catch {
    return [];
  }
}

function saveAll(rows: SentRecord[]) {
  ensureDataDirs();
  fs.writeFileSync(SENT_PATH, JSON.stringify(rows, null, 2));
}

export function alertKey(cpf: string, result: string) {
  return `${onlyDigits(cpf)}|${result.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

export function wasAlertSent(cpf: string, result: string) {
  const key = alertKey(cpf, result);
  return loadAll().some((row) => alertKey(row.cpf, row.result) === key);
}

export function markAlertSent(cpf: string, result: string) {
  const rows = loadAll().filter((row) => alertKey(row.cpf, row.result) !== alertKey(cpf, result));
  rows.push({ cpf: onlyDigits(cpf), result, sentAt: new Date().toISOString() });
  saveAll(rows);
}

export function clearSentAlerts() {
  saveAll([]);
}
