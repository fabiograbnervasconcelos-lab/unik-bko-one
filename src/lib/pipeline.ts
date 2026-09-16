import { launchBrowser, newContext } from "@/lib/browser";
import { collectCrmLeads, loginCrm, type CrmLead } from "@/lib/crm";
import { loginGed, lookupGedCpf } from "@/lib/ged";
import { buildAlertMessage, isPendingWhatsApp } from "@/lib/message";
import { markAlertSent, wasAlertSent } from "@/lib/sent-log";
import { loadSettings } from "@/lib/settings";
import {
  getSnapshot,
  getRunEpoch,
  log,
  setHourlyNote,
  setJob,
  setResults,
  setStep,
  isStopRequested,
  clearStop,
  patchResult,
  type LeadResult,
} from "@/lib/store";
import { formatCpf, isValidCpf, onlyDigits } from "@/lib/text";
import { isWhatsAppReady, sendWhatsAppText, type WhatsAppTarget } from "@/lib/whatsapp";

export type PipelineSource = "manual" | "hourly" | "whatsapp";

function parseExtraCpfs(raw: string): CrmLead[] {
  return raw
    .split(/[\s,;]+/)
    .map((value) => onlyDigits(value))
    .filter((value) => isValidCpf(value))
    .map((cpf) => ({
      name: "CPF extra",
      cpf: formatCpf(cpf),
      crmStatus: "aguardando biometria" as const,
    }));
}

function pendingCount(rows: LeadResult[]) {
  return rows.filter(isPendingWhatsApp).length;
}

function finishScan(results: LeadResult[], stopped: boolean, autoSend: boolean) {
  const pending = pendingCount(results);
  if (autoSend) return pending;
  if (pending > 0) {
    setJob("review", {
      error: null,
      step: stopped
        ? `Parado. ${pending} mensagem(ns) pronta(s) — confira e envie.`
        : `${pending} mensagem(ns) pronta(s) no WhatsApp. Confira, envie no painel ou mande validar e enviar no WhatsApp.`,
    });
    log("info", `Consulta pronta para validação. Mensagens a enviar: ${pending}.`);
    return pending;
  }
  if (stopped) {
    setJob("error", {
      error: "Consulta interrompida.",
      step: "Parado: nada para enviar no WhatsApp.",
    });
    log("warn", "Consulta interrompida sem mensagens para enviar.");
    return 0;
  }
  setJob("done", {
    step: `Concluído: ${results.length} CPF(s). GED não achou status — nada para enviar.`,
  });
  log("info", "Consulta concluída. Nenhuma mensagem para o WhatsApp.");
  return 0;
}

function requireReady(settings = loadSettings()) {
  if (getSnapshot().job === "running") {
    throw new Error("Já existe uma verificação em andamento.");
  }
  if (!isWhatsAppReady()) {
    throw new Error("Conecte o WhatsApp pelo QR antes de rodar a verificação.");
  }
  if (!settings.crmUser || !settings.crmPass) {
    throw new Error("Informe usuário e senha do CRM.");
  }
  if (!settings.gedUser || !settings.gedPass) {
    throw new Error("Informe usuário e senha do GED360.");
  }
  return settings;
}

export function startPipeline(options: { autoSend?: boolean; source?: PipelineSource } = {}) {
  const settings = requireReady();
  const autoSend = Boolean(options.autoSend);
  const source = options.source ?? "manual";

  setJob("running", {
    error: null,
    step: source === "hourly"
      ? "Leitura automática de hora em hora..."
      : source === "whatsapp"
        ? "Validar e enviar pelo WhatsApp..."
        : "Iniciando verificação...",
  });
  clearStop();
  void executePipeline(settings, { autoSend, source }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (getSnapshot().job === "running") {
      setJob("error", { error: message, step: "Verificação interrompida." });
    }
    log("error", message);
    if (source === "hourly") setHourlyNote(`Falha na leitura automática: ${message}`);
  });
  return getSnapshot();
}

export async function runPipeline() {
  return startPipeline();
}

async function executePipeline(
  settings: ReturnType<typeof loadSettings>,
  options: { autoSend: boolean; source: PipelineSource },
) {
  const { autoSend, source } = options;
  const epoch = getRunEpoch();
  setResults([]);
  log(
    "info",
    source === "hourly"
      ? "Leitura automática: CRM → GED360 → grupos WhatsApp + cópia de validação no 48 99194-0908."
      : "Verificação iniciada: CRM → GED360. WhatsApp só depois de validar na tela ou pelo comando.",
  );

  const browser = await launchBrowser();
  const results: LeadResult[] = [];

  try {
    const crmContext = await newContext(browser);
    const gedContext = await newContext(browser);
    const crmPage = await crmContext.newPage();
    const gedPage = await gedContext.newPage();

    await loginCrm(crmPage, settings.crmUser, settings.crmPass);
    const crmLeads = await collectCrmLeads(crmPage);
    const extra = parseExtraCpfs(settings.extraCpfs);
    const leads = [...crmLeads];
    for (const item of extra) {
      if (!leads.some((lead) => onlyDigits(lead.cpf) === onlyDigits(item.cpf))) {
        leads.push(item);
      }
    }

    if (!leads.length) {
      log("warn", "Nenhum CPF encontrado nos status do CRM nem na lista extra.");
      setJob("done", { step: "Nenhum CPF para consultar." });
      if (source === "hourly") {
        setHourlyNote("Leitura automática: nenhum CPF no CRM.");
      }
      if (autoSend && source === "whatsapp") {
        await sendWhatsAppText(
          "Unik BKO: rodei a consulta. Nenhum CPF em aguardando biometria / bio expirada.",
          ["owner"],
        ).catch(() => undefined);
      }
      return getSnapshot();
    }

    log("info", `GED: ${leads.length} CPF(s) para consultar, um de cada vez.`);
    await loginGed(gedPage, settings.gedUser, settings.gedPass, settings.gedDomain);

    for (const [index, lead] of leads.entries()) {
      if (getRunEpoch() !== epoch || isStopRequested()) {
        finishScan(results, true, autoSend);
        return getSnapshot();
      }
      setStep(`GED ${index + 1}/${leads.length}: ${lead.cpf}`);
      log("info", `GED ${index + 1}/${leads.length}: consultando ${lead.name} · ${lead.cpf}`);
      try {
        const lookup = await lookupGedCpf(gedPage, lead.cpf);
        const draftMessage = lookup.result ? buildAlertMessage({
          name: lead.name,
          cpf: lead.cpf,
          crmStatus: lead.crmStatus,
          gedResult: lookup.result,
        }) : null;
        const row: LeadResult = {
          id: `lead-${index}-${onlyDigits(lead.cpf)}`,
          name: lead.name,
          cpf: lead.cpf,
          crmStatus: lead.crmStatus,
          hasDigitization: lookup.hasDigitization,
          gedResult: lookup.result,
          draftMessage,
          notified: false,
          skipped: false,
          notifyTargets: [],
        };
        results.push(row);
        setResults([...results]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          id: `lead-${index}-${onlyDigits(lead.cpf)}`,
          name: lead.name,
          cpf: lead.cpf,
          crmStatus: lead.crmStatus,
          hasDigitization: false,
          gedResult: null,
          draftMessage: null,
          notified: false,
          skipped: false,
          notifyTargets: [],
          error: message,
        });
        setResults([...results]);
        log("error", `Falha no CPF ${lead.cpf}: ${message}`);
      }
    }

    if (getRunEpoch() !== epoch) {
      log("warn", "Consulta descartada: painel foi zerado.");
      return getSnapshot();
    }

    const pending = finishScan(results, false, autoSend);
    if (autoSend) {
      const queue = getSnapshot().results.filter(
        (row) => isPendingWhatsApp(row) && row.draftMessage,
      );
      if (!queue.length) {
        setJob("done", {
          step: `Concluído: ${results.length} CPF(s). GED não achou status — nada para enviar.`,
        });
        if (source === "hourly") {
          setHourlyNote(`Leitura automática: ${results.length} CPF(s), nenhum Resultado da Análise.`);
        }
        if (source === "whatsapp") {
          await sendWhatsAppText(
            "Unik BKO: consulta ok. O GED não mostrou Resultado da Análise — nada para enviar.",
            ["owner"],
          ).catch(() => undefined);
        }
        return getSnapshot();
      }
      await executeSend(queue, {
        includeGroups: true,
        skipDuplicates: source === "hourly",
        source,
      });
      return getSnapshot();
    }
    log("info", `Pendentes após a consulta: ${pending}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJob("error", { error: message, step: "Verificação interrompida." });
    log("error", message);
    if (source === "hourly") setHourlyNote(`Falha na leitura automática: ${message}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function startSend(ids: string[], options: { source?: PipelineSource } = {}) {
  if (getSnapshot().job === "running") {
    throw new Error("Aguarde a consulta ou o envio atual terminar.");
  }
  if (!isWhatsAppReady()) {
    throw new Error("Conecte o WhatsApp pelo QR antes de enviar.");
  }

  const wanted = new Set(ids);
  const queue = getSnapshot().results.filter(
    (row) => wanted.has(row.id) && isPendingWhatsApp(row) && row.draftMessage,
  );
  if (!queue.length) {
    throw new Error("Nenhuma mensagem selecionada para enviar.");
  }

  setJob("running", { error: null, step: `Enviando WhatsApp 0/${queue.length}...` });
  clearStop();
  void executeSend(queue, {
    includeGroups: true,
    skipDuplicates: false,
    source: options.source ?? "manual",
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("error", message);
    if (getSnapshot().job === "running") {
      setJob("error", { error: message, step: "Envio interrompido." });
    }
  });
  return getSnapshot();
}

export async function sendApprovedMessages(ids: string[]) {
  return startSend(ids);
}

async function executeSend(
  queue: LeadResult[],
  options: { includeGroups: boolean; skipDuplicates: boolean; source: PipelineSource },
) {
  const targets: WhatsAppTarget[] = ["owner"];
  if (options.includeGroups) {
    targets.push("bko", "gerentes");
  }

  log(
    "info",
    `Envio (${options.source}): ${queue.length} mensagem(ns) para ${targets.join(", ")}.`,
  );
  let sent = 0;
  let skippedDup = 0;
  for (const row of queue) {
    if (isStopRequested()) {
      const left = pendingCount(getSnapshot().results);
      setJob(left ? "review" : "error", {
        error: "Envio interrompido.",
        step: left
          ? `Parado. ${left} mensagem(ns) ainda na fila.`
          : "Parado: nenhum WhatsApp a mais será enviado.",
      });
      log("warn", "Envio interrompido pelo usuário.");
      return getSnapshot();
    }
    if (options.skipDuplicates && row.gedResult && wasAlertSent(row.cpf, row.gedResult)) {
      patchResult(row.id, {
        notified: true,
        notifyTargets: ["já avisado nas últimas 24h"],
      });
      skippedDup += 1;
      log("info", `GED ${row.cpf}: mesmo Resultado da Análise já foi avisado. Não reenvio.`);
      continue;
    }
    setStep(`Enviando WhatsApp ${sent + 1}/${queue.length}: ${row.cpf}`);
    try {
      const dest = await sendWhatsAppText(row.draftMessage!, targets);
      patchResult(row.id, { notified: true, notifyTargets: dest });
      if (row.gedResult) markAlertSent(row.cpf, row.gedResult);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      patchResult(row.id, { error: message });
      log("error", `Falha ao enviar ${row.cpf}: ${message}`);
    }
  }

  const left = pendingCount(getSnapshot().results);
  if (left > 0) {
    setJob("review", {
      error: null,
      step: `Enviadas ${sent}. Ainda há ${left} na fila para validar.`,
    });
  } else {
    setJob("done", {
      step: `Concluído: ${sent} alerta(s) enviados no WhatsApp${skippedDup ? ` (${skippedDup} já avisado(s))` : ""}.`,
    });
  }
  if (options.source === "hourly") {
    setHourlyNote(
      sent
        ? `Leitura automática: ${sent} aviso(s) no WhatsApp 48 99194-0908.`
        : skippedDup
          ? "Leitura automática: nada novo (já tinha avisado estes resultados)."
          : "Leitura automática: nenhum Resultado da Análise para avisar.",
    );
  }
  log("info", `Envio concluído. Enviadas: ${sent}. Pendentes: ${left}. Duplicatas: ${skippedDup}.`);
  return getSnapshot();
}

export function startValidateAndSendFromWhatsApp() {
  const pending = getSnapshot().results.filter(isPendingWhatsApp);
  if (pending.length) {
    log("info", `WhatsApp validar e enviar: ${pending.length} mensagem(ns) já na fila.`);
    return startSend(pending.map((row) => row.id), { source: "whatsapp" });
  }
  log("info", "WhatsApp validar e enviar: fila vazia — vou consultar CRM/GED e enviar o que achar.");
  return startPipeline({ autoSend: true, source: "whatsapp" });
}

export function startHourlyRun() {
  log("info", "Disparo automático de hora em hora.");
  return startPipeline({ autoSend: true, source: "hourly" });
}

export function discardMessages(ids: string[]) {
  const wanted = new Set(ids);
  const results = getSnapshot().results.map((row) =>
    wanted.has(row.id) && isPendingWhatsApp(row) ? { ...row, skipped: true } : row,
  );
  setResults(results);
  const left = pendingCount(results);
  setJob(left ? "review" : "done", {
    error: null,
    step: left
      ? `${left} mensagem(ns) ainda na fila.`
      : "Fila descartada. Nada será enviado.",
  });
  log("warn", `Descartadas ${ids.length} mensagem(ns) da fila do WhatsApp.`);
  return getSnapshot();
}

export async function sendTestWhatsApp() {
  if (!isWhatsAppReady()) {
    throw new Error("Conecte o WhatsApp pelo QR antes de testar.");
  }
  const sent = await sendWhatsAppText(
    "Teste Unik BKO One — conexão do painel ok. Podem ignorar esta mensagem.",
    ["owner", "bko", "gerentes"],
  );
  log("info", `Teste enviado para: ${sent.join(", ")}`);
  return sent;
}
