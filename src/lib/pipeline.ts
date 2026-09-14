import { launchBrowser, newContext } from "@/lib/browser";
import { collectCrmLeads, loginCrm, type CrmLead } from "@/lib/crm";
import { loginGed, lookupGedCpf } from "@/lib/ged";
import { loadSettings } from "@/lib/settings";
import { getSnapshot, log, setJob, setResults, setStep, isStopRequested, clearStop, type LeadResult } from "@/lib/store";
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

function buildAlertMessage(lead: LeadResult) {
  return [
    "URGENTE — BKO ONE",
    "",
    `CRM: ${lead.crmStatus}`,
    `Nome: ${lead.name}`,
    `CPF: ${lead.cpf}`,
    `GED360 Resultado da Análise: ${lead.gedResult}`,
    "",
    "Há digitalização no GED com um dos status de análise. Verificar agora.",
  ].join("\n");
}

export async function runPipeline() {
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
  setResults([]);
  log("info", "Verificação iniciada: CRM → GED360 → WhatsApp.");

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

    await loginGed(gedPage, settings.gedUser, settings.gedPass, settings.gedDomain);

    let firstGed = true;
    for (const [index, lead] of leads.entries()) {
      if (isStopRequested()) {
        log("warn", "Envio interrompido pelo usuário.");
        setJob("error", { error: "Envio interrompido.", step: "Parado: nenhum WhatsApp a mais será enviado." });
        return getSnapshot();
      }
      setStep(`GED ${index + 1}/${leads.length}: ${lead.cpf}`);
      try {
        const lookup = await lookupGedCpf(gedPage, lead.cpf, firstGed);
        firstGed = false;
        const shouldNotify = Boolean(lookup.hasDigitization && lookup.result);
        const row: LeadResult = {
          name: lead.name,
          cpf: lead.cpf,
          crmStatus: lead.crmStatus,
          hasDigitization: lookup.hasDigitization,
          gedResult: lookup.result,
          notified: false,
          notifyTargets: [],
        };
        if (shouldNotify) {
          if (isStopRequested()) {
            log("warn", "Envio interrompido antes do WhatsApp.");
            results.push(row);
            setResults([...results]);
            setJob("error", { error: "Envio interrompido.", step: "Parado: nenhum WhatsApp a mais será enviado." });
            return getSnapshot();
          }
          const targets = await sendWhatsAppText(buildAlertMessage(row), ["bko", "gerentes"]);
          row.notified = true;
          row.notifyTargets = targets;
        }
        results.push(row);
        setResults([...results]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: lead.name,
          cpf: lead.cpf,
          crmStatus: lead.crmStatus,
          hasDigitization: false,
          gedResult: null,
          notified: false,
          notifyTargets: [],
          error: message,
        });
        setResults([...results]);
        log("error", `Falha no CPF ${lead.cpf}: ${message}`);
      }
    }

    const notified = results.filter((item) => item.notified).length;
    setJob("done", {
      step: `Concluído: ${results.length} CPF(s), ${notified} alerta(s) no WhatsApp.`,
    });
    log("info", `Verificação concluída. Alertas enviados: ${notified}.`);
    return getSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJob("error", { error: message, step: "Verificação interrompida." });
    log("error", message);
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
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
