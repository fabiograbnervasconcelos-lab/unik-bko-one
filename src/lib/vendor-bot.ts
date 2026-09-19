import { runVendorCrmQuery, type VendorQueryKind } from "@/lib/crm-vendor";
import { log } from "@/lib/store";
import {
  askLoginMessage,
  askPasswordMessage,
  askUserOnlyMessage,
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
  askUserOnlyMessage,
  formatQueryResult,
  loggedInMessage,
  menuMessage,
} from "@/lib/vendor-helpers";

async function tryLogin(jid: string, user: string, pass: string) {
  const session = getVendorSession(jid);
  session.busy = true;
  try {
    await openVendorCrm(jid, user, pass);
    return loggedInMessage(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", `Login CRM vendedor falhou: ${message}`);
    setVendorPhase(jid, "awaiting_user", { busy: false, crmUser: null, pendingUser: null });
    return loginErrorMessage();
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

async function runOption(jid: string, kind: VendorQueryKind | "encerrar") {
  if (kind === "encerrar") {
    await destroyVendorSession(jid, { logout: true });
    return (
      `👋 Sessão encerrada e CRM deslogado.\n` +
      `Quando quiser de novo, mande qualquer mensagem que peço o usuário do CRM.`
    );
  }

  const session = getVendorSession(jid);
  session.busy = true;
  try {
    const page = await getVendorPage(jid);
    const result = await runVendorCrmQuery(page, kind);
    return formatQueryResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Busca CRM vendedor falhou (${kind}): ${message}`);
    if (message === "VENDOR_NOT_LOGGED" || /login\.php/i.test(message)) {
      await destroyVendorSession(jid, { logout: false });
      setVendorPhase(jid, "need_login");
      return (
        `⚠️ A sessão do CRM expirou ou não ficou aberta.\n` +
        `Envie o *usuário* do CRM para entrar de novo.`
      );
    }
    return (
      `❌ Deu erro ao buscar no CRM.\n` +
      `Pode tentar novamente? Digite a opção (*1–6*) ou *7* para encerrar.`
    );
  } finally {
    const current = getVendorSession(jid);
    if (current.crmUser && current.page) {
      current.phase = "menu";
      current.busy = false;
    } else {
      current.busy = false;
    }
  }
}

/**
 * Fluxo conversacional do vendedor no WhatsApp.
 * Usuário e senha em passos separados (mais seguro e claro).
 */
export async function handleVendorMessage(jid: string, text: string): Promise<string[]> {
  const raw = text.trim();
  if (!raw) return [];

  const session = getVendorSession(jid);
  if (session.busy) {
    return ["⏳ Estou consultando o CRM agora. Só um instante…"];
  }

  if (session.phase === "menu" && session.crmUser && session.page) {
    const option = optionFromText(raw);
    if (!option) return [menuMessage(session.crmUser)];
    return [await runOption(jid, option)];
  }

  // Já tem usuário, espera senha
  if (session.phase === "awaiting_pass" && session.pendingUser) {
    const pass = raw.replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (!pass) return [askPasswordMessage(session.pendingUser)];
    // Se mandou user+senha de novo, aceita o par
    const both = parseCredentials(raw);
    if (both) return [await tryLogin(jid, both.user, both.pass)];
    return [await tryLogin(jid, session.pendingUser, pass)];
  }

  // Primeira mensagem: só pede o usuário (campo claro)
  if (session.phase === "need_login") {
    setVendorPhase(jid, "awaiting_user");
    return [askUserOnlyMessage()];
  }

  // Esperando usuário (ou o par completo)
  if (session.phase === "awaiting_user") {
    const both = parseCredentials(raw);
    if (both) return [await tryLogin(jid, both.user, both.pass)];

    const user = raw
      .replace(/^(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*/i, "")
      .trim()
      .split(/\s+/)[0];
    if (user && user.length >= 2 && !/^\d+$/.test(user)) {
      setVendorPhase(jid, "awaiting_pass", { pendingUser: user });
      return [askPasswordMessage(user)];
    }
    return [askUserOnlyMessage()];
  }

  setVendorPhase(jid, "need_login");
  return [askUserOnlyMessage()];
}

/** Reinicia o pedido de login para um JID (usado pelo painel). */
export function resetVendorToAskLogin(jid: string) {
  setVendorPhase(jid, "awaiting_user", {
    crmUser: null,
    pendingUser: null,
    busy: false,
  });
  return askUserOnlyMessage();
}
