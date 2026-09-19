import { baixarBoletoPdf, consultarFaturaPorDoc } from "@/lib/fatura-robo";
import { runVendorCrmQuery, type VendorQueryKind } from "@/lib/crm-vendor";
import {
  confirmNioViability,
  emptyCoberturaState,
  parseCepInput,
  parseHouseNumberInput,
  startNioAddressLookup,
} from "@/lib/nio-cobertura";
import { log } from "@/lib/store";
import {
  afterCoberturaMessage,
  askCoberturaCepMessage,
  askCoberturaEnderecoMessage,
  askCoberturaNumeroMessage,
  askCpfFaturaMessage,
  askPasswordMessage,
  askUserOnlyMessage,
  coberturaEnderecoOptions,
  formatFaturaText,
  formatQueryResultMessages,
  formatQueryTimestamp,
  loggedInMessage,
  loginErrorMessage,
  menuMessage,
  optionFromText,
  parseCoberturaEnderecoPick,
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

function wantsMenu(text: string) {
  return /^(menu|voltar|opcoes|opções)$/i.test(text.trim());
}

function wantsAnotherCobertura(text: string) {
  return /^(sim|s|outra|outro|novo|nova|cobertura)$/i.test(text.trim());
}

async function tryLogin(jid: string, user: string, pass: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  session.busy = true;
  log("info", `Tentando login CRM vendedor (${user})…`);
  const outgoing: VendorOutgoing[] = texts(`⏳ Entrando no CRM com *${user}*…`);
  try {
    await openVendorCrm(jid, user, pass);
    outgoing.push(...texts(loggedInMessage(user)));
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", `Login CRM vendedor falhou (${user}): ${message}`);
    setVendorPhase(jid, "awaiting_pass", {
      busy: false,
      crmUser: null,
      pendingUser: user,
    });
    outgoing.push(...texts(loginErrorMessage(user)));
    return outgoing;
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
        `Envie o CPF novamente ou digite *1–7* / *8*.`,
    });
    return outgoing;
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

function startCoberturaFlow(jid: string): VendorOutgoing[] {
  setVendorPhase(jid, "awaiting_cobertura", {
    cobertura: emptyCoberturaState(),
  });
  return texts(askCoberturaCepMessage());
}

async function lookupCoberturaAddresses(jid: string, cep: string, numero: string) {
  const session = getVendorSession(jid);
  session.busy = true;
  const outgoing = texts(`⏳ Consultando cobertura no site da Nio para CEP *${cep}* nº *${numero}*…`);
  try {
    const result = await startNioAddressLookup(cep, numero);
    if (!result.logradouros.length) {
      setVendorPhase(jid, "awaiting_cobertura", {
        busy: false,
        cobertura: {
          step: "done",
          cep,
          numero,
          hash: result.hash,
          logradouros: [],
        },
      });
      outgoing.push({
        kind: "text",
        text:
          `❌ Não encontrei endereço para esse CEP/número no site da Nio.\n\n` +
          afterCoberturaMessage(),
      });
      return outgoing;
    }

    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: {
        step: "endereco",
        cep,
        numero,
        hash: result.hash,
        logradouros: result.logradouros,
      },
    });
    outgoing.push({
      kind: "text",
      text: askCoberturaEnderecoMessage(coberturaEnderecoOptions(result.logradouros)),
    });
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Cobertura Nio falhou no endereço: ${message}`);
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: { ...emptyCoberturaState(), step: "cep" },
    });
    outgoing.push({
      kind: "text",
      text:
        `❌ Não consegui consultar o endereço na Nio agora.\n` +
        `Tente de novo com o *CEP*.\n\n` +
        askCoberturaCepMessage(),
    });
    return outgoing;
  } finally {
    getVendorSession(jid).busy = false;
  }
}

async function finishCoberturaSelection(jid: string, addressIndex: number) {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura;
  if (!cobertura?.hash || !cobertura.logradouros[addressIndex]) {
    return texts(askCoberturaCepMessage());
  }
  const chosen = cobertura.logradouros[addressIndex];
  session.busy = true;
  const outgoing = texts(`⏳ Confirmando viabilidade em:\n*${chosen.descricao}*`);
  try {
    const viability = await confirmNioViability({
      hash: cobertura.hash,
      addressId: chosen.addressId,
      numero: cobertura.numero || "0",
    });
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: { ...cobertura, step: "done" },
    });
    if (viability.viavel) {
      const bits = [
        `✅ *Tem Nio Fibra no seu endereço.*`,
        ``,
        `📍 ${chosen.descricao}`,
      ];
      if (viability.description) bits.push(viability.description);
      if (viability.maxBandwidth) {
        bits.push(`Velocidade estimada até *${viability.maxBandwidth} Mbps*`);
      }
      bits.push("", afterCoberturaMessage());
      outgoing.push({ kind: "text", text: bits.join("\n") });
    } else {
      const bits = [
        `❌ *Não tem Nio Fibra no seu endereço.*`,
        ``,
        `📍 ${chosen.descricao}`,
      ];
      if (viability.description) bits.push(viability.description);
      bits.push("", afterCoberturaMessage());
      outgoing.push({ kind: "text", text: bits.join("\n") });
    }
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Cobertura Nio viabilidade falhou: ${message}`);
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: { ...cobertura, step: "done" },
    });
    outgoing.push({
      kind: "text",
      text:
        `❌ Não consegui confirmar a viabilidade nesse endereço.\n\n` +
        afterCoberturaMessage(),
    });
    return outgoing;
  } finally {
    getVendorSession(jid).busy = false;
  }
}

async function handleCoberturaMessage(jid: string, raw: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura || emptyCoberturaState();

  // Escapes seguros (não confundem com A/B nem com 1/2 do endereço)
  if (wantsMenu(raw)) {
    setVendorPhase(jid, "menu", { cobertura: null });
    return texts(menuMessage(session.crmUser));
  }
  if (/^(encerrar|sair|logout|deslogar)$/i.test(raw.trim()) || /^8\b/.test(raw.trim())) {
    return runOption(jid, "encerrar");
  }

  if (cobertura.step === "done") {
    const option = optionFromText(raw);
    if (wantsAnotherCobertura(raw) || option === "cobertura") {
      return startCoberturaFlow(jid);
    }
    if (option && option !== "cobertura") {
      setVendorPhase(jid, "menu", { cobertura: null });
      return runOption(jid, option);
    }
    setVendorPhase(jid, "menu", { cobertura: null });
    return texts(menuMessage(session.crmUser));
  }

  // Enquanto escolhe endereço: NÃO interpretar 1/2/7 como menu CRM
  if (cobertura.step === "endereco") {
    const pick = parseCoberturaEnderecoPick(raw, cobertura.logradouros.length);
    if (pick == null) {
      return texts(askCoberturaEnderecoMessage(coberturaEnderecoOptions(cobertura.logradouros)));
    }
    return finishCoberturaSelection(jid, pick);
  }

  if (cobertura.step === "cep") {
    // CEP numérico não pode virar opção de menu
    const cep = parseCepInput(raw);
    if (!cep) {
      const option = optionFromText(raw);
      if (option && option !== "cobertura") {
        setVendorPhase(jid, "menu", { cobertura: null });
        return runOption(jid, option);
      }
      return texts(askCoberturaCepMessage());
    }
    setVendorPhase(jid, "awaiting_cobertura", {
      cobertura: { ...cobertura, step: "numero", cep },
    });
    return texts(askCoberturaNumeroMessage(cep));
  }

  if (cobertura.step === "numero") {
    const numero = parseHouseNumberInput(raw);
    if (!numero) {
      const option = optionFromText(raw);
      if (option && option !== "cobertura") {
        setVendorPhase(jid, "menu", { cobertura: null });
        return runOption(jid, option);
      }
      return texts(askCoberturaNumeroMessage(cobertura.cep || ""));
    }
    return lookupCoberturaAddresses(jid, cobertura.cep || "", numero);
  }

  return startCoberturaFlow(jid);
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
    setVendorPhase(jid, "awaiting_cpf", { cobertura: null });
    return texts(askCpfFaturaMessage());
  }

  if (kind === "cobertura") {
    return startCoberturaFlow(jid);
  }

  const session = getVendorSession(jid);
  session.busy = true;
  try {
    const page = await getVendorPage(jid);
    const result = await runVendorCrmQuery(page, kind);
    setVendorPhase(jid, "menu", { busy: false, cobertura: null });
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
        `Pode tentar novamente? Digite a opção (*1–7*) ou *8* para encerrar.`,
    );
  } finally {
    const current = getVendorSession(jid);
    if (current.crmUser && current.page) {
      if (current.phase !== "awaiting_cpf" && current.phase !== "awaiting_cobertura") {
        current.phase = "menu";
      }
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

  if (session.phase === "awaiting_cobertura" && session.crmUser) {
    return handleCoberturaMessage(jid, raw);
  }

  // Aguardando CPF da fatura (mantém CRM logado)
  if (session.phase === "awaiting_cpf" && session.crmUser) {
    const option = optionFromText(raw);
    if (option) return runOption(jid, option);
    const doc = parseDocumentInput(raw);
    if (doc) return runFaturaLookup(jid, doc);
    return texts(askCpfFaturaMessage());
  }

  // Logado no CRM: menu / atalho CPF. Opções 6/7 não precisam do Playwright do CRM.
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
    if (option === "faturas" || option === "cobertura" || option === "encerrar") {
      return runOption(jid, option);
    }
    if (!session.page) {
      return texts(
        `⚠️ A aba do CRM caiu. Envie o *usuário* de novo para reabrir,\n` +
          `ou digite *6* (fatura) / *7* (cobertura) sem o CRM.`,
      );
    }
    return runOption(jid, option);
  }

  if (session.phase === "awaiting_pass" && session.pendingUser) {
    const both = parseCredentials(raw);
    if (both) return tryLogin(jid, both.user, both.pass);

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
    cobertura: null,
  });
  return askUserOnlyMessage();
}
