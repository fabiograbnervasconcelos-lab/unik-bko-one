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
import { dbgFatura } from "@/lib/debug-fatura";
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
  try {
    await openVendorCrm(jid, user, pass);
    return texts(loggedInMessage(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", `Login CRM vendedor falhou: ${message}`);
    setVendorPhase(jid, "awaiting_user", { busy: false, crmUser: null, pendingUser: null });
    return texts(loginErrorMessage());
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

async function runFaturaLookup(jid: string, docDigits: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  // #region agent log
  dbgFatura("C", "vendor-bot.ts:runFaturaLookup:entry", "Starting fatura lookup", {
    jid,
    docLen: docDigits.length,
    phase: session.phase,
    hasCrmUser: Boolean(session.crmUser),
    hasPage: Boolean(session.page),
  });
  // #endregion
  session.busy = true;
  const outgoing: VendorOutgoing[] = texts("⏳ Consultando fatura no Robô One Telecom…");
  try {
    const lookup = await consultarFaturaPorDoc(docDigits);
    const queriedAt = formatQueryTimestamp();
    const masked = lookup.maskedDocument || lookup.document?.formatted || docDigits;
    // #region agent log
    dbgFatura("C", "vendor-bot.ts:runFaturaLookup:ok", "Fatura lookup response mapped", {
      ok: lookup.ok,
      invoiceCount: lookup.invoices.length,
      hasCustomerName: Boolean(lookup.customerName),
      source: lookup.source,
      message: lookup.message?.slice(0, 120) ?? null,
    });
    // #endregion
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
      // #region agent log
      dbgFatura("D", "vendor-bot.ts:runFaturaLookup:pdf", "PDF download attempt", {
        index,
        hasPdf: Boolean(pdf),
        pdfUrl: invoice.pdfUrl ? "set" : null,
        customerId: invoice.customerId ? "set" : null,
        bytes: pdf?.buffer.length ?? 0,
      });
      // #endregion
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
    // #region agent log
    dbgFatura("C", "vendor-bot.ts:runFaturaLookup:err", "Fatura lookup threw", {
      message: message.slice(0, 200),
    });
    // #endregion
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
    // #region agent log
    dbgFatura("A", "vendor-bot.ts:runOption:faturas", "Option 6 selected — asking CPF", {
      jid,
      phase: getVendorSession(jid).phase,
      hasCrmUser: Boolean(getVendorSession(jid).crmUser),
      hasPage: Boolean(getVendorSession(jid).page),
    });
    // #endregion
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
  // #region agent log
  dbgFatura("A", "vendor-bot.ts:handleVendorMessage:entry", "Vendor message state", {
    jid,
    phase: session.phase,
    hasCrmUser: Boolean(session.crmUser),
    hasPage: Boolean(session.page),
    busy: session.busy,
    option: optionFromText(raw),
    docLen: parseDocumentInput(raw)?.length ?? 0,
    textPreview: raw.slice(0, 40),
  });
  // #endregion
  if (session.busy) {
    return texts("⏳ Estou consultando agora. Só um instante…");
  }

  // Aguardando CPF da fatura (mantém CRM logado)
  if (session.phase === "awaiting_cpf" && session.crmUser) {
    // #region agent log
    dbgFatura("B", "vendor-bot.ts:awaiting_cpf", "In awaiting_cpf branch", {
      hasPage: Boolean(session.page),
      option: optionFromText(raw),
      docLen: parseDocumentInput(raw)?.length ?? 0,
    });
    // #endregion
    const option = optionFromText(raw);
    if (option) return runOption(jid, option);
    const doc = parseDocumentInput(raw);
    if (doc) return runFaturaLookup(jid, doc);
    return texts(askCpfFaturaMessage());
  }

  if ((session.phase === "menu" || session.phase === "awaiting_cpf") && session.crmUser && session.page) {
    const option = optionFromText(raw);
    if (!option) {
      // Se mandou CPF direto no menu, também aceita como atalho da opção 6
      const doc = parseDocumentInput(raw);
      if (doc) {
        setVendorPhase(jid, "awaiting_cpf");
        return runFaturaLookup(jid, doc);
      }
      return texts(menuMessage(session.crmUser));
    }
    return runOption(jid, option);
  }

  // #region agent log
  if (
    (session.phase === "menu" || session.phase === "awaiting_cpf") &&
    session.crmUser &&
    !session.page
  ) {
    dbgFatura("B", "vendor-bot.ts:menuNoPage", "Logged crmUser but page missing — cannot reach option 6 menu path", {
      phase: session.phase,
      option: optionFromText(raw),
    });
  }
  // #endregion

  if (session.phase === "awaiting_pass" && session.pendingUser) {
    const pass = raw.replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (!pass) return texts(askPasswordMessage(session.pendingUser));
    const both = parseCredentials(raw);
    if (both) return tryLogin(jid, both.user, both.pass);
    return tryLogin(jid, session.pendingUser, pass);
  }

  if (session.phase === "need_login") {
    // #region agent log
    dbgFatura("A", "vendor-bot.ts:need_login", "Session not logged in — asking CRM user", {
      option: optionFromText(raw),
    });
    // #endregion
    setVendorPhase(jid, "awaiting_user");
    return texts(askUserOnlyMessage());
  }

  if (session.phase === "awaiting_user") {
    const both = parseCredentials(raw);
    if (both) return tryLogin(jid, both.user, both.pass);

    const user = raw
      .replace(/^(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*/i, "")
      .trim()
      .split(/\s+/)[0];
    if (user && user.length >= 2 && !/^\d+$/.test(user)) {
      setVendorPhase(jid, "awaiting_pass", { pendingUser: user });
      return texts(askPasswordMessage(user));
    }
    return texts(askUserOnlyMessage());
  }

  // #region agent log
  dbgFatura("A", "vendor-bot.ts:fallback_need_login", "Falling through to need_login", {
    phase: session.phase,
    hasCrmUser: Boolean(session.crmUser),
    hasPage: Boolean(session.page),
    option: optionFromText(raw),
  });
  // #endregion
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
