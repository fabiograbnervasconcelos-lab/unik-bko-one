import { runVendorCrmQuery, type VendorQueryKind } from "@/lib/crm-vendor";
import { log } from "@/lib/store";
import {
  askLoginMessage,
  askPasswordMessage,
  formatQueryResult,
  loggedInMessage,
  loginErrorMessage,
  menuMessage,
  optionFromText,
  parseCredentials,
} from "@/lib/vendor-helpers";
import {
  destroyVendorSession,
  getVendorPage,
  getVendorSession,
  openVendorCrm,
  setVendorPhase,
} from "@/lib/vendor-session";

export {
  askLoginMessage,
  formatQueryResult,
  loggedInMessage,
  menuMessage,
} from "@/lib/vendor-helpers";

async function tryLogin(jid: string, user: string, pass: string) {
  setVendorPhase(jid, "busy", { busy: true });
  try {
    await openVendorCrm(jid, user, pass);
    return loggedInMessage(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", `Login CRM vendedor falhou: ${message}`);
    setVendorPhase(jid, "awaiting_user", { busy: false, crmUser: null, pendingUser: null });
    return loginErrorMessage();
  } finally {
    const session = getVendorSession(jid);
    session.busy = false;
    if (session.phase === "busy") session.phase = session.crmUser ? "menu" : "awaiting_user";
  }
}

async function runOption(jid: string, kind: VendorQueryKind | "encerrar") {
  if (kind === "encerrar") {
    await destroyVendorSession(jid, { logout: true });
    return (
      `👋 Sessão encerrada e CRM deslogado.\n` +
      `Quando quiser de novo, mande qualquer mensagem que peço login e senha.`
    );
  }

  setVendorPhase(jid, "busy", { busy: true });
  try {
    const page = await getVendorPage(jid);
    const result = await runVendorCrmQuery(page, kind);
    setVendorPhase(jid, "menu", { busy: false });
    return formatQueryResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Busca CRM vendedor falhou (${kind}): ${message}`);
    if (message === "VENDOR_NOT_LOGGED" || /login\.php/i.test(message)) {
      await destroyVendorSession(jid, { logout: false });
      setVendorPhase(jid, "need_login");
      return (
        `⚠️ A sessão do CRM expirou.\n` +
        `Envie qualquer mensagem para começar de novo (vou pedir login e senha).`
      );
    }
    setVendorPhase(jid, "menu", { busy: false });
    return (
      `❌ Deu erro ao buscar no CRM.\n` +
      `Pode tentar novamente? Digite a opção (*1–6*) ou *7* para encerrar.`
    );
  }
}

/**
 * Fluxo conversacional do vendedor no WhatsApp.
 */
export async function handleVendorMessage(jid: string, text: string): Promise<string[]> {
  const raw = text.trim();
  if (!raw) return [];

  const session = getVendorSession(jid);
  if (session.busy || session.phase === "busy") {
    return ["⏳ Estou consultando o CRM agora. Só um instante…"];
  }

  if (session.phase === "menu" && session.crmUser) {
    const option = optionFromText(raw);
    if (!option) return [menuMessage(session.crmUser)];
    return [await runOption(jid, option)];
  }

  if (session.phase === "awaiting_pass" && session.pendingUser) {
    const pass = raw.replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (!pass) return [askPasswordMessage(session.pendingUser)];
    return [await tryLogin(jid, session.pendingUser, pass)];
  }

  if (session.phase === "need_login") {
    setVendorPhase(jid, "awaiting_user");
    return [askLoginMessage()];
  }

  if (session.phase === "awaiting_user") {
    const creds = parseCredentials(raw);
    if (creds) return [await tryLogin(jid, creds.user, creds.pass)];
    if (raw.split(/\s+/).length === 1 && raw.length >= 2 && !/^\d+$/.test(raw)) {
      setVendorPhase(jid, "awaiting_pass", { pendingUser: raw });
      return [askPasswordMessage(raw)];
    }
    return [askLoginMessage()];
  }

  setVendorPhase(jid, "need_login");
  return [askLoginMessage()];
}
