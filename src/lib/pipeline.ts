import { launchBrowser, newContext } from "@/lib/browser";
import { collectCrmLeads, loginCrm, type CrmLead } from "@/lib/crm";
import { loginGed, lookupGedCpf } from "@/lib/ged";
import { buildAlertMessage, isPendingWhatsApp } from "@/lib/message";
import { loadSettings } from "@/lib/settings";
import {
  getSnapshot,
  log,
  setJob,
  setResults,
  setStep,
  isStopRequested,
  clearStop,
  patchResult,
  type LeadResult,
} from "@/lib/store";
import { formatCpf, isValidCpf, onlyDigits } from "@/lib/text";
import { isWhatsAppReady, sendWhatsAppText } from "@/lib/whatsapp";

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

function finishScan(results: LeadResult[], stopped: boolean) {
  const pending = pendingCount(results);
  if (pending > 0) {
    setJob("review", {
      error: null,
      step: stopped
        ? `Parado. ${pending} mensagem(ns) pronta(s) — confira e envie.`
        : `${pending} mensagem(ns) pronta(s) no WhatsApp. Confira e envie.`,
    });
    log("info", `Consulta pronta para validação. Mensagens a enviar: ${pending}.`);
    return;
  }
  if (stopped) {
    setJob("error", {
      error: "Consulta interrompida.",
      step: "Parado: nada para enviar no WhatsApp.",
    });
    log("warn", "Consulta interrompida sem mensagens para enviar.");
    return;
  }
  setJob("done", {
    step: `Concluído: ${results.length} CPF(s). GED não achou status — nada para enviar.`,
  });
  log("info", "Consulta concluída. Nenhuma mensagem para o WhatsApp.");
}

export function startPipeline() {
  if (getSnapshot().job === "running") {
    throw new Error("Já existe uma verificação em andamento.");
  }
  if (!isWhatsAppReady()) {
    throw new Error("Conecte o WhatsApp pelo QR antes de rodar a verificação.");
  }

  const settings = loadSettings();
  if (!settings.crmUser || !settings.crmPass) {
    throw new Error("Informe usuário e senha do CRM.");
  }
  if (!settings.gedUser || !settings.gedPass) {
    throw new Error("Informe usuário e senha do GED360.");
  }

  setJob("running", { error: null, step: "Iniciando verificação..." });
  clearStop();
  void executePipeline(settings).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (getSnapshot().job === "running") {
      setJob("error", { error: message, step: "Verificação interrompida." });
    }
    log("error", message);
  });
  return getSnapshot();
}

export async function runPipeline() {
  return startPipeline();
}

async function executePipeline(settings: ReturnType<typeof loadSettings>) {
  setResults([]);
  log("info", "Verificação iniciada: CRM → GED360. WhatsApp só depois de validar na tela.");

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
      return getSnapshot();
    }

    log("info", `GED: ${leads.length} CPF(s) para consultar, um de cada vez.`);
    await loginGed(gedPage, settings.gedUser, settings.gedPass, settings.gedDomain);

    for (const [index, lead] of leads.entries()) {
      if (isStopRequested()) {
        finishScan(results, true);
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

    finishScan(results, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJob("error", { error: message, step: "Verificação interrompida." });
    log("error", message);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function startSend(ids: string[]) {
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
  void executeSend(queue).catch((error) => {
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
) {

  log("info", `Envio validado: ${queue.length} mensagem(ns) para os grupos.`);
  let sent = 0;
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
    setStep(`Enviando WhatsApp ${sent + 1}/${queue.length}: ${row.cpf}`);
    try {
      const targets = await sendWhatsAppText(row.draftMessage!, ["bko", "gerentes"]);
      patchResult(row.id, { notified: true, notifyTargets: targets });
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
      step: `Concluído: ${sent} alerta(s) enviados no WhatsApp.`,
    });
  }
  log("info", `Envio concluído. Enviadas: ${sent}. Pendentes: ${left}.`);
  return getSnapshot();
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
    ["bko", "gerentes"],
  );
  log("info", `Teste enviado para: ${sent.join(", ")}`);
  return sent;
}
