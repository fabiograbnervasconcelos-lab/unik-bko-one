import type { Browser, BrowserContext, Page } from "playwright";
import { launchBrowser, newContext } from "@/lib/browser";
import { loginCrmAsVendor, logoutCrmPage } from "@/lib/crm-vendor";
import { log } from "@/lib/store";

export type VendorPhase =
  | "need_login"
  | "awaiting_user"
  | "awaiting_pass"
  | "menu"
  | "awaiting_cpf"
  | "busy";

export type VendorSession = {
  jid: string;
  phase: VendorPhase;
  crmUser: string | null;
  pendingUser: string | null;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  lastActiveAt: number;
  busy: boolean;
};

const IDLE_MS = 45 * 60 * 1000;

const globalForVendor = globalThis as typeof globalThis & {
  unikVendorSessions?: Map<string, VendorSession>;
  unikVendorBrowser?: Browser | null;
};

const sessions: Map<string, VendorSession> =
  globalForVendor.unikVendorSessions ?? new Map<string, VendorSession>();
globalForVendor.unikVendorSessions = sessions;

const aliases: Map<string, string> =
  (globalForVendor as typeof globalForVendor & { unikVendorAliases?: Map<string, string> })
    .unikVendorAliases ?? new Map<string, string>();
(globalForVendor as typeof globalForVendor & { unikVendorAliases?: Map<string, string> }).unikVendorAliases =
  aliases;

function emptySession(jid: string): VendorSession {
  return {
    jid,
    phase: "need_login",
    crmUser: null,
    pendingUser: null,
    browser: null,
    context: null,
    page: null,
    lastActiveAt: Date.now(),
    busy: false,
  };
}

export function getVendorSession(jid: string) {
  const key = resolveVendorJid(jid);
  const existing = sessions.get(key);
  if (!existing) {
    const created = emptySession(key);
    sessions.set(key, created);
    return created;
  }
  if (existing.phase === "menu" && Date.now() - existing.lastActiveAt > IDLE_MS) {
    void destroyVendorSession(key, { logout: true }).catch(() => undefined);
    const created = emptySession(key);
    sessions.set(key, created);
    return created;
  }
  existing.lastActiveAt = Date.now();
  return existing;
}

function mergeVendorSessionState(target: VendorSession, source: VendorSession) {
  if (!target.crmUser && source.crmUser) target.crmUser = source.crmUser;
  if (!target.pendingUser && source.pendingUser) target.pendingUser = source.pendingUser;
  if (!target.page && source.page) {
    target.page = source.page;
    target.context = source.context;
    target.browser = source.browser;
  }
  // Preferir fase mais avançada no login / já logada
  const rank: Record<VendorPhase, number> = {
    need_login: 0,
    awaiting_user: 1,
    awaiting_pass: 2,
    busy: 3,
    awaiting_cpf: 4,
    menu: 5,
  };
  if ((rank[source.phase] ?? 0) > (rank[target.phase] ?? 0)) {
    target.phase = source.phase;
  }
  if (source.lastActiveAt > target.lastActiveAt) {
    target.lastActiveAt = source.lastActiveAt;
  }
  if (source.busy) target.busy = true;
}

/** Une LID (@lid) e telefone (@s.whatsapp.net) na mesma sessão do vendedor. */
export function linkVendorJids(a: string, b: string) {
  if (!a || !b || a === b) return;
  const keyA = resolveVendorJid(a);
  const keyB = resolveVendorJid(b);
  // Já apontam para a mesma chave — só reforça aliases. NÃO apagar a sessão.
  if (keyA === keyB) {
    aliases.set(a, keyA);
    aliases.set(b, keyA);
    return;
  }
  const sessionA = sessions.get(keyA);
  const sessionB = sessions.get(keyB);
  let canonical = keyA;
  if (sessionB && !sessionA) canonical = keyB;
  else if (sessionA && sessionB) {
    // Preferir a sessão já logada / com página / mais avançada no login
    if (!sessionA.crmUser && sessionB.crmUser) canonical = keyB;
    else if (!sessionA.page && sessionB.page) canonical = keyB;
    else if (
      !sessionA.crmUser &&
      !sessionB.crmUser &&
      (sessionB.pendingUser || sessionB.phase === "awaiting_pass") &&
      !(sessionA.pendingUser || sessionA.phase === "awaiting_pass")
    ) {
      canonical = keyB;
    }
  }
  aliases.set(a, canonical);
  aliases.set(b, canonical);
  aliases.set(keyA, canonical);
  aliases.set(keyB, canonical);
  if (canonical === keyA && sessionB && sessionA) {
    mergeVendorSessionState(sessionA, sessionB);
    sessions.delete(keyB);
  } else if (canonical === keyB && sessionA && sessionB) {
    mergeVendorSessionState(sessionB, sessionA);
    sessions.delete(keyA);
  }
}

/** Só para testes: limpa Map em memória. */
export function resetVendorSessionStoreForTests() {
  sessions.clear();
  aliases.clear();
}

function resolveVendorJid(jid: string) {
  return aliases.get(jid) || jid;
}

export function listVendorSessions() {
  return [...sessions.values()].map((session) => ({
    jid: session.jid,
    phase: session.phase,
    crmUser: session.crmUser,
    lastActiveAt: session.lastActiveAt,
    busy: session.busy,
  }));
}

async function sharedBrowser() {
  if (globalForVendor.unikVendorBrowser) {
    try {
      if (globalForVendor.unikVendorBrowser.isConnected()) {
        return globalForVendor.unikVendorBrowser;
      }
    } catch {
      // recreate
    }
  }
  globalForVendor.unikVendorBrowser = await launchBrowser();
  return globalForVendor.unikVendorBrowser;
}

export async function openVendorCrm(jid: string, user: string, pass: string) {
  const session = getVendorSession(jid);
  await destroyVendorSession(jid, { logout: false });
  const browser = await sharedBrowser();
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await loginCrmAsVendor(page, user, pass);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  const next = getVendorSession(jid);
  next.browser = browser;
  next.context = context;
  next.page = page;
  next.crmUser = user;
  next.pendingUser = null;
  next.phase = "menu";
  next.busy = false;
  next.lastActiveAt = Date.now();
  log("info", `Sessão CRM do vendedor aberta (${user}).`);
  return next;
}

export async function getVendorPage(jid: string) {
  const session = getVendorSession(jid);
  // Aceita menu ou busy: a busca marca busy sem derrubar a sessão logada.
  if (!session.page || !session.crmUser) {
    throw new Error("VENDOR_NOT_LOGGED");
  }
  if (session.phase !== "menu" && session.phase !== "busy" && session.phase !== "awaiting_cpf") {
    throw new Error("VENDOR_NOT_LOGGED");
  }
  try {
    if (session.page.isClosed()) {
      await destroyVendorSession(jid, { logout: false });
      throw new Error("VENDOR_NOT_LOGGED");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "VENDOR_NOT_LOGGED") throw error;
    await destroyVendorSession(jid, { logout: false });
    throw new Error("VENDOR_NOT_LOGGED");
  }
  const url = session.page.url();
  if (url.includes("login.php")) {
    await destroyVendorSession(jid, { logout: false });
    throw new Error("VENDOR_NOT_LOGGED");
  }
  return session.page;
}

export async function destroyVendorSession(jid: string, options: { logout: boolean }) {
  const key = resolveVendorJid(jid);
  const session = sessions.get(key);
  if (!session) return;
  try {
    if (options.logout && session.page) {
      await logoutCrmPage(session.page).catch(() => undefined);
    }
  } finally {
    await session.context?.close().catch(() => undefined);
    sessions.set(key, emptySession(key));
  }
}

export function setVendorPhase(jid: string, phase: VendorPhase, patch: Partial<VendorSession> = {}) {
  const session = getVendorSession(jid);
  session.phase = phase;
  Object.assign(session, patch);
  session.lastActiveAt = Date.now();
  return session;
}

export function vendorSessionCount() {
  return [...sessions.values()].filter((session) => session.phase === "menu").length;
}
