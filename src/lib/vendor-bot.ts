import { baixarBoletoPdf, consultarFaturaPorDoc } from "@/lib/fatura-robo";
import { runVendorCrmQuery, type VendorQueryKind } from "@/lib/crm-vendor";
import {
  confirmNioViability,
  emptyCoberturaState,
  getCombinacaoOptionsForLevel,
  needsComplementSelection,
  parseCepInput,
  parseHouseNumberInput,
  selectNioAddress,
  startNioAddressLookup,
  type NioComplementPart,
} from "@/lib/nio-cobertura";
import {
  formatVendaLancadaMessage,
  listNioPapSellers,
  matchSellerByCrmUser,
  papCredentialsFromEnv,
  papDiasDefault,
  syncNioPapVenda,
  vendaFoiLancada,
} from "@/lib/nio-pap-crm";
import { log } from "@/lib/store";
import {
  afterCoberturaMessage,
  afterVendaMessage,
  askCoberturaCepMessage,
  askCoberturaComplementoMessage,
  askCoberturaEnderecoMessage,
  askCoberturaNumeroMessage,
  askCpfFaturaMessage,
  askCpfVendaMessage,
  askPapMatriculaMessage,
  askPapSenhaMessage,
  askPasswordMessage,
  askUserOnlyMessage,
  coberturaComplementoOptions,
  coberturaEnderecoOptions,
  declinesCobertura,
  formatCoberturaComplementSummary,
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
  wantsAnotherCobertura,
} from "@/lib/vendor-helpers";
import {
  destroyVendorSession,
  getVendorPage,
  getVendorSession,
  openVendorCrm,
  setVendorPhase,
  type VendorVendaState,
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
      crmPass: null,
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
        `Envie o CPF novamente ou digite *1–8* / *9*.`,
    });
    return outgoing;
  } finally {
    const current = getVendorSession(jid);
    current.busy = false;
  }
}

function emptyVendaState(patch: Partial<VendorVendaState> = {}): VendorVendaState {
  return {
    step: "cpf",
    papMatricula: null,
    papSenha: null,
    ...patch,
  };
}

function startVendaFlow(jid: string): VendorOutgoing[] {
  const envPap = papCredentialsFromEnv();
  if (envPap) {
    setVendorPhase(jid, "awaiting_venda", {
      cobertura: null,
      venda: emptyVendaState({
        step: "cpf",
        papMatricula: envPap.matricula,
        papSenha: envPap.senha,
      }),
    });
    return texts(askCpfVendaMessage());
  }

  const session = getVendorSession(jid);
  if (session.venda?.papMatricula && session.venda?.papSenha) {
    setVendorPhase(jid, "awaiting_venda", {
      cobertura: null,
      venda: emptyVendaState({
        step: "cpf",
        papMatricula: session.venda.papMatricula,
        papSenha: session.venda.papSenha,
      }),
    });
    return texts(askCpfVendaMessage());
  }

  setVendorPhase(jid, "awaiting_venda", {
    cobertura: null,
    venda: emptyVendaState({ step: "pap_user" }),
  });
  return texts(askPapMatriculaMessage());
}

async function runVendaLaunch(jid: string, docDigits: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  const crmUser = session.crmUser;
  const crmPass = session.crmPass;
  const venda = session.venda || emptyVendaState();
  const papMatricula = venda.papMatricula || papCredentialsFromEnv()?.matricula || null;
  const papSenha = venda.papSenha || papCredentialsFromEnv()?.senha || null;

  if (!crmUser || !crmPass) {
    setVendorPhase(jid, "need_login", { busy: false, venda: null });
    return texts(
      `⚠️ Preciso da senha do CRM para lançar a venda.\n` +
        `Envie o *usuário* do CRM para entrar de novo.`,
    );
  }
  if (!papMatricula || !papSenha) {
    setVendorPhase(jid, "awaiting_venda", {
      busy: false,
      venda: emptyVendaState({ step: "pap_user" }),
    });
    return texts(askPapMatriculaMessage());
  }

  session.busy = true;
  const dias = papDiasDefault();
  const outgoing: VendorOutgoing[] = texts(
    `⏳ Lançando a venda no PAP → CRM…\n` +
      `Documento: *${docDigits}*\n` +
      `Vendedor: *${crmUser}*\n` +
      `_Última venda dos últimos ${dias} dias._`,
  );

  try {
    const sellers = await listNioPapSellers({ crmUsuario: crmUser, crmSenha: crmPass });
    const seller = matchSellerByCrmUser(sellers, crmUser);
    if (!seller) {
      setVendorPhase(jid, "awaiting_venda", {
        busy: false,
        venda: { ...venda, step: "cpf" },
      });
      outgoing.push({
        kind: "text",
        text:
          `❌ Não achei o vendedor *${crmUser}* na lista do CRM/PAP.\n` +
          `Confira se o login é o mesmo nome do vendedor na pré-venda.\n\n` +
          afterVendaMessage(),
      });
      return outgoing;
    }

    const result = await syncNioPapVenda({
      documento: docDigits,
      dias,
      vendedorId: seller.id,
      papMatricula,
      papSenha,
      crmUsuario: crmUser,
      crmSenha: crmPass,
    });

    setVendorPhase(jid, "awaiting_venda", {
      busy: false,
      venda: {
        step: "cpf",
        papMatricula,
        papSenha,
      },
    });

    if (!result.encontrados || !result.escolhida) {
      outgoing.push({
        kind: "text",
        text:
          `❌ Nenhuma venda de *${result.documento || docDigits}* nos últimos *${result.dias || dias}* dias no PAP.\n\n` +
          afterVendaMessage(),
      });
      return outgoing;
    }

    if (vendaFoiLancada(result)) {
      outgoing.push({
        kind: "text",
        text: `${formatVendaLancadaMessage(result)}\n\n${afterVendaMessage()}`,
      });
      return outgoing;
    }

    const first = result.resultados?.[0] || result.escolhida;
    const detail =
      first?.error ||
      first?.skipped ||
      result.resumoWhatsapp ||
      "O sistema não confirmou o lançamento da pré-venda.";
    outgoing.push({
      kind: "text",
      text:
        `⚠️ Encontrei a venda, mas *não confirmou o lançamento*.\n` +
        `${detail}\n\n` +
        afterVendaMessage(),
    });
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `PAP CRM lançamento falhou: ${message}`);
    setVendorPhase(jid, "awaiting_venda", {
      busy: false,
      venda: {
        step: "cpf",
        papMatricula,
        papSenha,
      },
    });
    outgoing.push({
      kind: "text",
      text:
        `❌ Não consegui lançar a venda agora.\n` +
        `${message}\n\n` +
        afterVendaMessage(),
    });
    return outgoing;
  } finally {
    getVendorSession(jid).busy = false;
  }
}

async function handleVendaMessage(jid: string, raw: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  const venda = session.venda || emptyVendaState();

  if (wantsMenu(raw)) {
    setVendorPhase(jid, "menu", { venda: null });
    return texts(menuMessage(session.crmUser));
  }
  if (/^(encerrar|sair|logout|deslogar)$/i.test(raw.trim()) || /^9\b/.test(raw.trim())) {
    return runOption(jid, "encerrar");
  }

  const option = optionFromText(raw);
  if (option && option !== "venda") {
    setVendorPhase(jid, "menu", { venda: null });
    return runOption(jid, option);
  }

  if (venda.step === "pap_user") {
    const matricula = raw.replace(/^(?:matricula|login|user)\s*[:=]\s*/i, "").trim().split(/\s+/)[0];
    if (!matricula || matricula.length < 2 || isNonUsernameNoise(matricula)) {
      return texts(askPapMatriculaMessage());
    }
    setVendorPhase(jid, "awaiting_venda", {
      venda: emptyVendaState({ step: "pap_pass", papMatricula: matricula }),
    });
    return texts(askPapSenhaMessage(matricula));
  }

  if (venda.step === "pap_pass") {
    const senha = raw.replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (!senha || isNonUsernameNoise(senha)) {
      return texts(askPapSenhaMessage(venda.papMatricula || ""));
    }
    setVendorPhase(jid, "awaiting_venda", {
      venda: emptyVendaState({
        step: "cpf",
        papMatricula: venda.papMatricula,
        papSenha: senha,
      }),
    });
    return texts(askCpfVendaMessage());
  }

  const doc = parseDocumentInput(raw);
  if (!doc) {
    return texts(askCpfVendaMessage());
  }
  return runVendaLaunch(jid, doc);
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
          ...emptyCoberturaState(),
          step: "done",
          cep,
          numero,
          hash: result.hash,
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
        ...emptyCoberturaState(),
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

function currentComplementOptions(cobertura: NonNullable<ReturnType<typeof getVendorSession>["cobertura"]>) {
  return getCombinacaoOptionsForLevel(
    cobertura.combinacoes,
    cobertura.complementLevel || 1,
    cobertura.complementSelections || [],
  );
}

async function finishCoberturaViability(
  jid: string,
  complementSelections: NioComplementPart[],
) {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura;
  if (!cobertura?.hash || !cobertura.selectedAddressId) {
    return texts(askCoberturaCepMessage());
  }
  const addressLabel = cobertura.selectedAddressLabel || "endereço selecionado";
  session.busy = true;
  const outgoing = texts(
    `⏳ Confirmando viabilidade em:\n*${addressLabel}*`,
  );
  try {
    const viability = await confirmNioViability({
      hash: cobertura.hash,
      addressId: cobertura.selectedAddressId,
      numero: cobertura.numero || "0",
      complementSelections,
      addressAlreadySelected: true,
    });
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: {
        ...cobertura,
        step: "done",
        complementSelections,
      },
    });
    const location = formatCoberturaComplementSummary(addressLabel, complementSelections);
    if (viability.viavel) {
      const bits = [
        `✅ *Tem Nio Fibra no seu endereço.*`,
        ``,
        `📍 ${location}`,
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
        `📍 ${location}`,
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

async function finishCoberturaSelection(jid: string, addressIndex: number) {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura;
  if (!cobertura?.hash || !cobertura.logradouros[addressIndex]) {
    return texts(askCoberturaCepMessage());
  }
  const chosen = cobertura.logradouros[addressIndex];
  session.busy = true;
  const outgoing = texts(`⏳ Carregando complementos de:\n*${chosen.descricao}*`);
  try {
    const selected = await selectNioAddress({
      hash: cobertura.hash,
      addressId: chosen.addressId,
      numero: cobertura.numero || "0",
    });

    if (!needsComplementSelection(selected.maxNiveis, selected.combinacoes)) {
      setVendorPhase(jid, "awaiting_cobertura", {
        busy: false,
        cobertura: {
          ...cobertura,
          selectedAddressId: chosen.addressId,
          selectedAddressLabel: chosen.descricao,
          combinacoes: selected.combinacoes,
          maxNiveis: selected.maxNiveis,
          complementLevel: 1,
          complementSelections: [],
        },
      });
      // libera busy antes da viabilidade (ela marca busy de novo)
      session.busy = false;
      return finishCoberturaViability(jid, []);
    }

    const level = 1;
    const options = getCombinacaoOptionsForLevel(selected.combinacoes, level, []);
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: {
        ...cobertura,
        step: "complemento",
        selectedAddressId: chosen.addressId,
        selectedAddressLabel: chosen.descricao,
        combinacoes: selected.combinacoes,
        maxNiveis: selected.maxNiveis,
        complementLevel: level,
        complementSelections: [],
      },
    });
    outgoing.push({
      kind: "text",
      text: askCoberturaComplementoMessage(coberturaComplementoOptions(options), level),
    });
    return outgoing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Cobertura Nio seleção de endereço falhou: ${message}`);
    setVendorPhase(jid, "awaiting_cobertura", {
      busy: false,
      cobertura: { ...cobertura, step: "endereco" },
    });
    outgoing.push({
      kind: "text",
      text:
        `❌ Não consegui carregar os complementos desse endereço.\n` +
        `Escolha o endereço de novo.\n\n` +
        askCoberturaEnderecoMessage(coberturaEnderecoOptions(cobertura.logradouros)),
    });
    return outgoing;
  } finally {
    getVendorSession(jid).busy = false;
  }
}

async function handleComplementoPick(jid: string, raw: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura || emptyCoberturaState();
  const level = cobertura.complementLevel || 1;
  const options = currentComplementOptions(cobertura);
  if (!options.length) {
    return finishCoberturaViability(jid, cobertura.complementSelections || []);
  }

  const pick = parseCoberturaEnderecoPick(raw, options.length);
  if (pick == null) {
    return texts(askCoberturaComplementoMessage(coberturaComplementoOptions(options), level));
  }

  const chosen = options[pick];
  const nextSelections: NioComplementPart[] = [
    ...(cobertura.complementSelections || []).slice(0, level - 1),
    {
      tipo: chosen.tipo,
      valor: chosen.valor,
      descricao: chosen.descricao,
    },
  ];

  if (level < (cobertura.maxNiveis || 0) && level < 3) {
    const nextLevel = level + 1;
    const nextOptions = getCombinacaoOptionsForLevel(
      cobertura.combinacoes,
      nextLevel,
      nextSelections,
    );
    if (nextOptions.length) {
      setVendorPhase(jid, "awaiting_cobertura", {
        cobertura: {
          ...cobertura,
          step: "complemento",
          complementLevel: nextLevel,
          complementSelections: nextSelections,
        },
      });
      return texts(
        askCoberturaComplementoMessage(coberturaComplementoOptions(nextOptions), nextLevel),
      );
    }
  }

  return finishCoberturaViability(jid, nextSelections);
}

async function handleCoberturaMessage(jid: string, raw: string): Promise<VendorOutgoing[]> {
  const session = getVendorSession(jid);
  const cobertura = session.cobertura || emptyCoberturaState();

  // Escapes seguros (não confundem com A/B nem com 1/2 do endereço)
  if (wantsMenu(raw)) {
    setVendorPhase(jid, "menu", { cobertura: null });
    return texts(menuMessage(session.crmUser));
  }
  if (/^(encerrar|sair|logout|deslogar)$/i.test(raw.trim()) || /^9\b/.test(raw.trim())) {
    return runOption(jid, "encerrar");
  }

  if (cobertura.step === "done") {
    const option = optionFromText(raw);
    if (wantsAnotherCobertura(raw) || option === "cobertura") {
      return startCoberturaFlow(jid);
    }
    if (declinesCobertura(raw)) {
      setVendorPhase(jid, "menu", { cobertura: null });
      return texts(menuMessage(session.crmUser));
    }
    if (option) {
      setVendorPhase(jid, "menu", { cobertura: null });
      return runOption(jid, option);
    }
    // Resposta ambígua: repete S/N em vez de reiniciar CEP
    return texts(afterCoberturaMessage());
  }

  // Enquanto escolhe endereço / complemento: NÃO interpretar 1/2/7 como menu CRM
  if (cobertura.step === "endereco") {
    const pick = parseCoberturaEnderecoPick(raw, cobertura.logradouros.length);
    if (pick == null) {
      return texts(askCoberturaEnderecoMessage(coberturaEnderecoOptions(cobertura.logradouros)));
    }
    return finishCoberturaSelection(jid, pick);
  }

  if (cobertura.step === "complemento") {
    return handleComplementoPick(jid, raw);
  }

  if (cobertura.step === "cep") {
    // "não" no pedido de CEP = desistiu → menu (não reperguntar CEP)
    if (declinesCobertura(raw)) {
      setVendorPhase(jid, "menu", { cobertura: null });
      return texts(menuMessage(session.crmUser));
    }
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
    if (declinesCobertura(raw)) {
      setVendorPhase(jid, "menu", { cobertura: null });
      return texts(menuMessage(session.crmUser));
    }
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
    setVendorPhase(jid, "awaiting_cpf", { cobertura: null, venda: null });
    return texts(askCpfFaturaMessage());
  }

  if (kind === "cobertura") {
    return startCoberturaFlow(jid);
  }

  if (kind === "venda") {
    return startVendaFlow(jid);
  }

  const session = getVendorSession(jid);
  session.busy = true;
  try {
    const page = await getVendorPage(jid);
    const result = await runVendorCrmQuery(page, kind);
    setVendorPhase(jid, "menu", { busy: false, cobertura: null, venda: null });
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
        `Pode tentar novamente? Digite a opção (*1–8*) ou *9* para encerrar.`,
    );
  } finally {
    const current = getVendorSession(jid);
    if (current.crmUser && current.page) {
      if (
        current.phase !== "awaiting_cpf" &&
        current.phase !== "awaiting_cobertura" &&
        current.phase !== "awaiting_venda"
      ) {
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

  if (session.phase === "awaiting_venda" && session.crmUser) {
    return handleVendaMessage(jid, raw);
  }

  // Aguardando CPF da fatura (mantém CRM logado)
  if (session.phase === "awaiting_cpf" && session.crmUser) {
    const option = optionFromText(raw);
    if (option) return runOption(jid, option);
    const doc = parseDocumentInput(raw);
    if (doc) return runFaturaLookup(jid, doc);
    return texts(askCpfFaturaMessage());
  }

  // Logado no CRM: menu / atalho CPF. Opções 6/7/8 não precisam do Playwright do CRM.
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
    if (
      option === "faturas" ||
      option === "cobertura" ||
      option === "venda" ||
      option === "encerrar"
    ) {
      return runOption(jid, option);
    }
    if (!session.page) {
      return texts(
        `⚠️ A aba do CRM caiu. Envie o *usuário* de novo para reabrir,\n` +
          `ou digite *6* (fatura) / *7* (cobertura) / *8* (venda) sem o CRM.`,
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
    crmPass: null,
    pendingUser: null,
    busy: false,
    cobertura: null,
    venda: null,
  });
  return askUserOnlyMessage();
}
