import type { Browser, BrowserContext, Page } from "playwright";
import { launchBrowser, newContext } from "@/lib/browser";
import { loginCrmAsVendor, logoutCrmPage } from "@/lib/crm-vendor";
import { log } from "@/lib/store";

export type VendorPhase = "need_login" | "awaiting_user" | "awaiting_pass" | "menu" | "busy";

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
  const existing = sessions.get(jid);
  if (!existing) {
    const created = emptySession(jid);
    sessions.set(jid, created);
    return created;
  }
  if (existing.phase === "menu" && Date.now() - existing.lastActiveAt > IDLE_MS) {
    void destroyVendorSession(jid, { logout: true }).catch(() => undefined);
    const created = emptySession(jid);
    sessions.set(jid, created);
    return created;
  }
  existing.lastActiveAt = Date.now();
  return existing;
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
  if (!session.page || session.phase !== "menu") {
    throw new Error("VENDOR_NOT_LOGGED");
  }
  // Se caiu no login, força relogar
  const url = session.page.url();
  if (url.includes("login.php")) {
    await destroyVendorSession(jid, { logout: false });
    throw new Error("VENDOR_NOT_LOGGED");
  }
  return session.page;
}

export async function destroyVendorSession(jid: string, options: { logout: boolean }) {
  const session = sessions.get(jid);
  if (!session) return;
  try {
    if (options.logout && session.page) {
      await logoutCrmPage(session.page).catch(() => undefined);
    }
  } finally {
    await session.context?.close().catch(() => undefined);
    sessions.set(jid, emptySession(jid));
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
