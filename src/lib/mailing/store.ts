import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { hashPassword, newId } from "@/lib/mailing/crypto";
import type {
  MailingLead,
  MailingUser,
  PapCredentials,
  ScrapeProgress,
} from "@/lib/mailing/types";

const MAILING_DIR = path.join(DATA_DIR, "mailing");
const USERS_PATH = path.join(MAILING_DIR, "users.json");
const LEADS_PATH = path.join(MAILING_DIR, "leads.json");
const PAP_PATH = path.join(MAILING_DIR, "pap-credentials.json");
const SCRAPE_PATH = path.join(MAILING_DIR, "scrape-progress.json");

const globalMailing = globalThis as typeof globalThis & {
  mailingLeadsCache?: MailingLead[];
  mailingUsersCache?: MailingUser[];
  mailingScrape?: ScrapeProgress;
  mailingWriteLock?: Promise<void>;
};

function ensureMailingDir() {
  ensureDataDirs();
  fs.mkdirSync(MAILING_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureMailingDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  ensureMailingDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = globalMailing.mailingWriteLock ?? Promise.resolve();
  let release!: () => void;
  globalMailing.mailingWriteLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function seedMaster(): MailingUser {
  const now = new Date().toISOString();
  return {
    id: "user_master_fabio",
    name: "Fabio",
    username: "fabio",
    passwordHash: hashPassword("One@2026"),
    role: "master",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadUsers(): MailingUser[] {
  if (globalMailing.mailingUsersCache) return globalMailing.mailingUsersCache;
  let users = readJson<MailingUser[]>(USERS_PATH, []);
  if (!users.some((u) => u.username.toLowerCase() === "fabio" && u.role === "master")) {
    users = [seedMaster(), ...users.filter((u) => u.username.toLowerCase() !== "fabio")];
    writeJson(USERS_PATH, users);
  }
  globalMailing.mailingUsersCache = users;
  return users;
}

export function saveUsers(users: MailingUser[]) {
  globalMailing.mailingUsersCache = users;
  writeJson(USERS_PATH, users);
}

export function loadLeads(): MailingLead[] {
  if (globalMailing.mailingLeadsCache) return globalMailing.mailingLeadsCache;
  const leads = readJson<MailingLead[]>(LEADS_PATH, []);
  globalMailing.mailingLeadsCache = leads;
  return leads;
}

export function saveLeads(leads: MailingLead[]) {
  globalMailing.mailingLeadsCache = leads;
  writeJson(LEADS_PATH, leads);
}

export async function updateLeads(
  mutator: (leads: MailingLead[]) => MailingLead[],
): Promise<MailingLead[]> {
  return withLock(() => {
    const next = mutator([...loadLeads()]);
    saveLeads(next);
    return next;
  });
}

export async function updateUsers(
  mutator: (users: MailingUser[]) => MailingUser[],
): Promise<MailingUser[]> {
  return withLock(() => {
    const next = mutator([...loadUsers()]);
    saveUsers(next);
    return next;
  });
}

function looksLikeEmail(value: string | undefined | null) {
  const v = String(value || "").trim();
  return v.includes("@") && v.length >= 5;
}

export function loadPapCredentials(): PapCredentials {
  const fromFile = readJson<Partial<PapCredentials>>(PAP_PATH, {});
  const envEmail = (process.env.PAP_USER || process.env.NIO_PAP_USER || "").trim();
  const envPass = (process.env.PAP_PASS || process.env.NIO_PAP_PASS || "").trim();
  // Preferência: variáveis de ambiente do Railway > arquivo > default.
  // Evita senha poluída no volume (ex.: One@2026 do login mailing).
  const fileEmail = looksLikeEmail(fromFile.email) ? String(fromFile.email).trim() : "";
  const filePass = fileEmail ? String(fromFile.password || "").trim() : "";
  return {
    email: envEmail || fileEmail || "TT829944@vtalcorp.onmicrosoft.com",
    password: envPass || filePass || "Niosuper001one",
  };
}

export function savePapCredentials(creds: PapCredentials) {
  const email = String(creds.email || "").trim();
  const password = String(creds.password || "").trim();
  if (!looksLikeEmail(email)) {
    throw new Error("Login PAP inválido: use o e-mail completo (ex.: TT829944@vtalcorp.onmicrosoft.com).");
  }
  writeJson(PAP_PATH, { email, password });
}

export function defaultScrapeProgress(): ScrapeProgress {
  return {
    state: "idle",
    message: "Pronto para buscar interesses no PAP.",
    logs: [],
    dateFrom: "16/10/2026",
    dateTo: "16/10/2026",
    saleType: "interesse",
    page: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    startedAt: null,
    finishedAt: null,
    lastLeadName: null,
    currentUrl: null,
    liveShotLabel: null,
    liveShotAt: null,
  };
}

export function loadScrapeProgress(): ScrapeProgress {
  if (globalMailing.mailingScrape) return globalMailing.mailingScrape;
  const progress = readJson<ScrapeProgress>(SCRAPE_PATH, defaultScrapeProgress());
  // Compatível com progress antigo sem `logs`
  if (!Array.isArray(progress.logs)) progress.logs = [];
  globalMailing.mailingScrape = progress;
  return progress;
}

export function saveScrapeProgress(progress: ScrapeProgress) {
  globalMailing.mailingScrape = progress;
  writeJson(SCRAPE_PATH, progress);
}

export function findLeadByCpf(leads: MailingLead[], document?: string | null) {
  const docKey = onlyDigits(document || "");
  if (!docKey || docKey.length < 11) return -1;
  return leads.findIndex((item) => onlyDigits(item.document || "") === docKey);
}

export function upsertLeadByKey(
  leads: MailingLead[],
  lead: Omit<MailingLead, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  },
  options?: { allowDuplicateCpf?: boolean },
): {
  leads: MailingLead[];
  created: boolean;
  skipped: boolean;
  skipReason?: "cpf";
  lead: MailingLead;
} {
  const now = new Date().toISOString();
  const phoneKey = onlyPhone(lead.phone);
  const docKey = onlyDigits(lead.document || "");
  const papKey = (lead.papId || "").trim();
  const normalizedDoc = docKey.length >= 11 ? docKey : "";
  const allowDuplicateCpf = Boolean(options?.allowDuplicateCpf);

  // CPF já cadastrado → não grava / não atualiza (exceto Venda, onde CPF duplicado é ok)
  if (normalizedDoc && !allowDuplicateCpf) {
    const byCpf = findLeadByCpf(leads, normalizedDoc);
    if (byCpf >= 0) {
      return {
        leads,
        created: false,
        skipped: true,
        skipReason: "cpf",
        lead: leads[byCpf]!,
      };
    }
  }

  const existingIndex = leads.findIndex((item) => {
    if (papKey && item.papId && item.papId === papKey) return true;
    // Venda com CPF duplicado permitido: só deduplica pelo papId/pedido
    if (allowDuplicateCpf) return false;
    if (
      phoneKey &&
      onlyPhone(item.phone) === phoneKey &&
      normalizeName(item.name) === normalizeName(lead.name)
    ) {
      return true;
    }
    return false;
  });

  if (existingIndex >= 0) {
    const prev = leads[existingIndex]!;
    // Se o lead existente já tem CPF e o novo traz outro CPF, não sobrescreve
    const prevDoc = onlyDigits(prev.document || "");
    if (
      !allowDuplicateCpf &&
      prevDoc.length >= 11 &&
      normalizedDoc &&
      prevDoc !== normalizedDoc
    ) {
      return {
        leads,
        created: false,
        skipped: true,
        skipReason: "cpf",
        lead: prev,
      };
    }
    const merged: MailingLead = {
      ...prev,
      ...lead,
      id: prev.id,
      document: prev.document || normalizedDoc || lead.document,
      queue: prev.queue === "transferir" ? lead.queue || prev.queue : prev.queue,
      assignedTo: prev.assignedTo,
      assignedAt: prev.assignedAt,
      treatingSince: prev.treatingSince,
      closedAt: prev.closedAt,
      createdAt: prev.createdAt,
      updatedAt: now,
      part1: { ...(prev.part1 || {}), ...(lead.part1 || {}) },
      part2: { ...(prev.part2 || {}), ...(lead.part2 || {}) },
      planData: { ...(prev.planData || {}), ...(lead.planData || {}) },
      raw: { ...(prev.raw || {}), ...(lead.raw || {}) },
    };
    const next = [...leads];
    next[existingIndex] = merged;
    return { leads: next, created: false, skipped: false, lead: merged };
  }

  const created: MailingLead = {
    id: lead.id || newId("lead"),
    source: lead.source,
    queue: lead.queue || "transferir",
    name: lead.name,
    phone: lead.phone,
    document: normalizedDoc || lead.document,
    email: lead.email,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    plan: lead.plan,
    saleType: lead.saleType,
    saleDate: lead.saleDate,
    papId: lead.papId,
    part1: lead.part1,
    part2: lead.part2,
    planData: lead.planData,
    notes: lead.notes,
    raw: lead.raw,
    assignedTo: lead.assignedTo ?? null,
    assignedAt: lead.assignedAt ?? null,
    treatingSince: lead.treatingSince ?? null,
    closedAt: lead.closedAt ?? null,
    createdAt: lead.createdAt || now,
    updatedAt: now,
    createdBy: lead.createdBy,
  };
  return { leads: [...leads, created], created: true, skipped: false, lead: created };
}

export function onlyDigits(value: string) {
  return value.replace(/\D+/g, "");
}

export function onlyPhone(value: string) {
  const digits = onlyDigits(value);
  if (digits.length >= 12 && digits.startsWith("55")) return digits.slice(-11);
  return digits.slice(-11);
}

export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function publicUser(user: MailingUser) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
