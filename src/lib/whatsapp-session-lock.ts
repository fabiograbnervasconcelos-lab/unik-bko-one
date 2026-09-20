import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { log } from "@/lib/store";

const LOCK_PATH = path.join(DATA_DIR, "whatsapp-session.lock");
const CREDS_PATH = path.join(DATA_DIR, "whatsapp-auth", "creds.json");
const STALE_MS = 90_000;

type LockPayload = {
  pid: number;
  deploymentId: string;
  hostname: string;
  updatedAt: number;
};

function deploymentId() {
  return (
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.RAILWAY_REPLICA_ID ||
    process.env.HOSTNAME ||
    "local"
  );
}

function readLock(): LockPayload | null {
  try {
    if (!fs.existsSync(LOCK_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as LockPayload;
    if (!parsed?.updatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLock() {
  ensureDataDirs();
  const payload: LockPayload = {
    pid: process.pid,
    deploymentId: deploymentId(),
    hostname: process.env.HOSTNAME || "unknown",
    updatedAt: Date.now(),
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload));
}

/** True se já existe sessão Baileys registrada (não precisa de QR). */
export function hasRegisteredWhatsAppAuth() {
  try {
    if (!fs.existsSync(CREDS_PATH)) return false;
    const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as {
      registered?: boolean;
      me?: unknown;
    };
    return Boolean(creds.registered || creds.me);
  } catch {
    return false;
  }
}

export function authFilesPresent() {
  return fs.existsSync(CREDS_PATH);
}

/**
 * Garante um único dono da sessão no volume.
 * Lock velho (>90s sem heartbeat) é roubado — típico após SIGKILL no deploy.
 */
export async function acquireWhatsAppSessionLock(timeoutMs = 25_000): Promise<boolean> {
  ensureDataDirs();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = readLock();
    if (!current) {
      writeLock();
      log("info", "Lock da sessão WhatsApp adquirido.");
      return true;
    }
    const age = Date.now() - current.updatedAt;
    const mine =
      current.pid === process.pid && current.deploymentId === deploymentId();
    if (mine) {
      writeLock();
      return true;
    }
    if (age > STALE_MS) {
      log(
        "warn",
        `Lock WhatsApp antigo (${Math.round(age / 1000)}s) — assumindo após deploy/SIGKILL.`,
      );
      writeLock();
      return true;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  log("error", "Não consegui o lock da sessão WhatsApp a tempo.");
  return false;
}

export function touchWhatsAppSessionLock() {
  try {
    const current = readLock();
    if (current && current.pid === process.pid) writeLock();
  } catch {
    // ignore
  }
}

export function releaseWhatsAppSessionLock() {
  try {
    const current = readLock();
    if (!current || current.pid === process.pid) {
      fs.rmSync(LOCK_PATH, { force: true });
    }
  } catch {
    // ignore
  }
}
