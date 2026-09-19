import { baixarBoletoPdf, consultarFaturaPorDoc } from "@/lib/fatura-robo";
import { runVendorCrmQuery, type VendorQueryKind } from "@/lib/crm-vendor";
import { log } from "@/lib/store";
import {
  askCpfFaturaMessage,
  askPasswordMessage,
  askUserOnlyMessage,
  formatFaturaText,
  formatQueryResultMessages,
  formatQueryTimestamp,
  loggedInMessage,
  loginErrorMessage,
  menuMessage,
  optionFromText,
  parseCredentials,
  parseDocumentInput,
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

export type VendorOutgoing =
  | { kind: "text"; text: string }
  | { kind: "pdf"; data: Buffer; fileName: string; caption?: string };

function texts(...values: string[]): VendorOutgoing[] {
  return values.filter(Boolean).map((text) => ({ kind: "text" as const, text }));
}

async function tryLogin(jid: string, user: string, pass: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  session.busy = true;
  log("info", `Tentando login CRM vendedor (${user})…`);
  try {
    await openVendorCrm(jid, user, pass);
    return texts(loggedInMessage(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", `Login CRM vendedor falhou (${user}): ${message}`);
    // Mantém o usuário: só pede a senha de novo
    setVendorPhase(jid, "awaiting_pass", {
      busy: false,
      crmUser: null,
      pendingUser: user,
    });
    return texts(loginErrorMessage(user));
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

/** Saudações / lixo que não são usuário CRM. */
function isNonUsernameNoise(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return /^(oi+|ola+|olá+|hey|hi+|hello|bom dia|boa tarde|boa noite|eai|e ai|tudo bem|td bem|menu|iniciar|start|ajuda|help)$/i.test(
    normalized,
  );
}

function captureUsername(raw: string): string | null {
  const user = raw
    .replace(/^(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*/i, "")
    .trim()
    .split(/\s+/)[0];
  if (!user || user.length < 2 || /^\d+$/.test(user) || isNonUsernameNoise(user)) {
    return null;
  }
  return user;
}

async function runFaturaLookup(jid: string, docDigits: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  session.busy = true;
  const outgoing: VendorOutgoing[] = texts("⏳ Consultando fatura no Robô One Telecom…");
  try {
    const lookup = await consultarFaturaPorDoc(docDigits);
    const queriedAt = formatQueryTimestamp();
    const masked = lookup.maskedDocument || lookup.document?.formatted || docDigits;
    outgoing.push({
      kind: "text",
      text: formatFaturaText({
        maskedDoc: masked,
        customerName: lookup.customerName,
        invoices: lookup.invoices,
        queriedAt,
      }),
    });

    for (const [index, invoice] of lookup.invoices.entries()) {
      const pdf = await baixarBoletoPdf(invoice);
      if (!pdf) continue;
      outgoing.push({
        kind: "pdf",
        data: pdf.buffer,
        fileName: pdf.fileName,
        caption: `Boleto ${index + 1} — venc. ${invoice.dueDate}`,
      });
    }

    setVendorPhase(jid, "awaiting_cpf", { busy: false });
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Fatura Robô One falhou: ${message}`);
    setVendorPhase(jid, "awaiting_cpf", { busy: false });
    outgoing.push({
      kind: "text",
      text:
        `❌ Não consegui consultar a fatura agora.\n` +
        `${message}\n\n` +
        `Envie o CPF novamente ou digite *1–5* / *7*.`,
    });
    return outgoing;
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

async function runOption(jid: string, kind: VendorQueryKind | "encerrar"): Promise<VendorOutgoing[]> {
  if (kind === "encerrar") {
    await destroyVendorSession(jid, { logout: true });
    return texts(
      `👋 Sessão encerrada e CRM deslogado.\n` +
        `Quando quiser de novo, mande qualquer mensagem que peço o usuário do CRM.`,
    );
  }

  if (kind === "faturas") {
    setVendorPhase(jid, "awaiting_cpf");
    return texts(askCpfFaturaMessage());
  }

  const session = getVendorSession(jid);
  session.busy = true;
  try {
    const page = await getVendorPage(jid);
    const result = await runVendorCrmQuery(page, kind);
    setVendorPhase(jid, "menu", { busy: false });
    return formatQueryResultMessages(result).map((text) => ({ kind: "text" as const, text }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Busca CRM vendedor falhou (${kind}): ${message}`);
    if (message === "VENDOR_NOT_LOGGED" || /login\.php/i.test(message)) {
      await destroyVendorSession(jid, { logout: false });
      setVendorPhase(jid, "need_login");
      return texts(
        `⚠️ A sessão do CRM expirou ou não ficou aberta.\n` +
          `Envie o *usuário* do CRM para entrar de novo.`,
      );
    }
    setVendorPhase(jid, "menu", { busy: false });
    return texts(
      `❌ Deu erro ao buscar no CRM.\n` +
        `Pode tentar novamente? Digite a opção (*1–6*) ou *7* para encerrar.`,
    );
  } finally {
    const current = getVendorSession(jid);
    if (current.crmUser && current.page) {
      if (current.phase !== "awaiting_cpf") current.phase = "menu";
      current.busy = false;
    } else {
      current.busy = false;
    }
  }
}

/**
 * Fluxo conversacional do vendedor no WhatsApp.
 */
export async function handleVendorMessage(jid: string, text: string): Promise<VendorOutgoing[]> {
  const raw = text.trim();
  if (!raw) return [];

  const session = getVendorSession(jid);
  if (session.busy) {
    return texts("⏳ Estou consultando agora. Só um instante…");
  }

  // Aguardando CPF da fatura (mantém CRM logado)
  if (session.phase === "awaiting_cpf" && session.crmUser) {
    const option = optionFromText(raw);
    if (option) return runOption(jid, option);
    const doc = parseDocumentInput(raw);
    if (doc) return runFaturaLookup(jid, doc);
    return texts(askCpfFaturaMessage());
  }

  // Logado no CRM: menu / atalho CPF. Opção 6 (fatura) não precisa do Playwright.
  if ((session.phase === "menu" || session.phase === "awaiting_cpf") && session.crmUser) {
    const option = optionFromText(raw);
    if (!option) {
      const doc = parseDocumentInput(raw);
      if (doc) {
        setVendorPhase(jid, "awaiting_cpf");
        return runFaturaLookup(jid, doc);
      }
      return texts(menuMessage(session.crmUser));
    }
    if (option === "faturas" || option === "encerrar") {
      return runOption(jid, option);
    }
    if (!session.page) {
      return texts(
        `⚠️ A aba do CRM caiu. Envie o *usuário* de novo para reabrir,\n` +
          `ou digite *6* para consultar fatura sem o CRM.`,
      );
    }
    return runOption(jid, option);
  }

  if (session.phase === "awaiting_pass" && session.pendingUser) {
    // Credenciais completas na mesma mensagem (usuario + senha)
    const both = parseCredentials(raw);
    if (both) return tryLogin(jid, both.user, both.pass);

    // Troca explícita de usuário: "usuario: fulano" (nunca tratar senha solta como login)
    const labeledUser = raw.match(/^(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*(\S+)/i);
    if (labeledUser?.[1]) {
      const nextUser = captureUsername(labeledUser[1]) || labeledUser[1];
      if (nextUser && !isNonUsernameNoise(nextUser)) {
        setVendorPhase(jid, "awaiting_pass", { pendingUser: nextUser });
        log("info", `Vendedor trocou usuário CRM para (${nextUser}); pedindo senha.`);
        return texts(askPasswordMessage(nextUser));
      }
    }

    const pass = raw.replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (!pass || isNonUsernameNoise(pass)) {
      return texts(askPasswordMessage(session.pendingUser));
    }
    return tryLogin(jid, session.pendingUser, pass);
  }

  // need_login e awaiting_user: aceita usuário, ou usuário+senha na mesma msg
  if (session.phase === "need_login" || session.phase === "awaiting_user") {
    const both = parseCredentials(raw);
    if (both) return tryLogin(jid, both.user, both.pass);

    const user = captureUsername(raw);
    if (user) {
      setVendorPhase(jid, "awaiting_pass", { pendingUser: user });
      log("info", `Vendedor informou usuário CRM (${user}); pedindo senha.`);
      return texts(askPasswordMessage(user));
    }

    if (session.phase === "need_login") {
      setVendorPhase(jid, "awaiting_user");
    }
    return texts(askUserOnlyMessage());
  }

  setVendorPhase(jid, "need_login");
  return texts(askUserOnlyMessage());
}

export function resetVendorToAskLogin(jid: string) {
  setVendorPhase(jid, "awaiting_user", {
    crmUser: null,
    pendingUser: null,
    busy: false,
  });
  return askUserOnlyMessage();
}
