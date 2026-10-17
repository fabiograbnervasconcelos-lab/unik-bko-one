import type { Browser, Page } from "playwright";
import { launchBrowser } from "@/lib/browser";
import { newId } from "@/lib/mailing/crypto";
import {
  loadPapCredentials,
  loadScrapeProgress,
  onlyDigits,
  onlyPhone,
  savePapCredentials,
  saveScrapeProgress,
  updateLeads,
  upsertLeadByKey,
  defaultScrapeProgress,
} from "@/lib/mailing/store";
import type { LeadPartData, MailingLead, ScrapeProgress } from "@/lib/mailing/types";

const PAP_HOME = "https://pap.niointernet.com.br/";
const PAP_HISTORICO = "https://pap.niointernet.com.br/administrativo/historico";

export type PapSaleType = "interesse" | "venda";

export type PapScrapeOptions = {
  dateFrom: string; // dd/mm/yyyy
  dateTo: string; // dd/mm/yyyy
  /** Interesse = regra atual; Venda = só AGUARDANDO TRATAMENTO, dados da lista (sem Avançar). */
  saleType?: PapSaleType | string;
  maxPages?: number;
};

const STATUS_PRIMARIO_VENDA = "Aguardando tratamento";
const STATUS_PRIMARIO_VENDA_KEY = "ANALISE_BO";

export function normalizeSaleType(value?: string | null): PapSaleType {
  const raw = String(value || "interesse").trim().toLowerCase();
  if (raw === "venda" || raw === "sale" || raw === "vendas") return "venda";
  return "interesse";
}

/** Venda: apenas status primário Aguardando tratamento (ANALISE_BO). */
export function matchesVendaAguardandoTratamento(venda: Record<string, unknown>): boolean {
  const primary = String(venda.chaveStatusPrimario || "").toUpperCase();
  if (primary === STATUS_PRIMARIO_VENDA_KEY) return true;
  const status = String(venda.status || venda.subStatus || "");
  return /aguardando\s*tratamento/i.test(status);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function humanPause(min = 900, max = 1800) {
  await sleep(min + Math.floor(Math.random() * (max - min)));
}

function parseBrDate(value: string) {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
}

function updateProgress(patch: Partial<ScrapeProgress>) {
  const current = loadScrapeProgress();
  const next = { ...current, ...patch };
  if (!Array.isArray(next.logs)) next.logs = current.logs || [];
  saveScrapeProgress(next);
  return next;
}

function scrapeLog(line: string, patch: Partial<ScrapeProgress> = {}) {
  const current = loadScrapeProgress();
  const stamp = new Date().toLocaleTimeString("pt-BR", {
    hour12: false,
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const entry = `[${stamp}] ${line}`;
  const logs = [...(current.logs || []), entry].slice(-300);
  const next: ScrapeProgress = {
    ...current,
    ...patch,
    message: line,
    logs,
  };
  saveScrapeProgress(next);
  return next;
}

function isOnPap(url: string) {
  return /pap\.niointernet\.com\.br/i.test(url) && !/login\.microsoftonline|microsoft\.com\/login/i.test(url);
}

async function loginPap(page: Page, email: string, password: string) {
  scrapeLog(`Abrindo PAP: ${PAP_HOME}`, { currentUrl: PAP_HOME });
  await page.goto(PAP_HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
  scrapeLog(`Página carregada: ${page.url()}`, { currentUrl: page.url() });

  scrapeLog("Aguardando campo de e-mail Microsoft…");
  await page.waitForSelector("#i0116", { timeout: 45000 });
  await humanPause(600, 1000);
  scrapeLog(`Preenchendo e-mail: ${email}`);
  await page.fill("#i0116", email);
  await humanPause(350, 650);
  scrapeLog("Clicando Avançar (e-mail)…");
  await page.click("#idSIButton9");

  scrapeLog("Aguardando campo de senha…");
  await page.waitForSelector("#i0118", { state: "visible", timeout: 45000 });
  await humanPause(800, 1300);
  scrapeLog("Preenchendo senha…");
  await page.fill("#i0118", password);
  await humanPause(350, 650);
  scrapeLog("Clicando Entrar (senha)…");
  await page.click("#idSIButton9");
  await sleep(2000);

  // Não usar waitForURL(..., load): SPA Microsoft/PAP muitas vezes não dispara "load".
  const deadline = Date.now() + 120_000;
  let lastLoggedUrl = "";
  while (Date.now() < deadline) {
    const url = page.url();
    if (url !== lastLoggedUrl) {
      scrapeLog(`Login: URL = ${url}`, { currentUrl: url });
      lastLoggedUrl = url;
    }

    if (isOnPap(url)) {
      scrapeLog("Login Microsoft OK — entrou no PAP.");
      break;
    }

    const pwdError = page.locator("#passwordError, #usernameError, .alert-error, #errorText");
    if (await pwdError.count()) {
      const errText = ((await pwdError.first().innerText().catch(() => "")) || "").trim();
      if (errText) throw new Error(`Login Microsoft recusado: ${errText}`);
    }

    // "Stay signed in?" / KMSI / Continuar
    const kmsi = page.locator("#idSIButton9, #idBtn_Accept, input[type='submit']#idSIButton9");
    if (await kmsi.count()) {
      const visible = await kmsi.first().isVisible().catch(() => false);
      if (visible) {
        scrapeLog("Clicando Continuar / Manter conectado…");
        await kmsi.first().click({ force: true }).catch(() => undefined);
        await sleep(2500);
        continue;
      }
    }

    const yesBtn = page.getByRole("button", { name: /^(Yes|Sim|Continuar|Next|Avançar)$/i });
    if (await yesBtn.count()) {
      scrapeLog("Clicando botão de confirmação Microsoft…");
      await yesBtn.first().click({ force: true }).catch(() => undefined);
      await sleep(2000);
      continue;
    }

    await sleep(1500);
  }

  if (!isOnPap(page.url())) {
    throw new Error(
      `Timeout no login PAP (sem waitUntil=load). URL final: ${page.url()}. Verifique senha/KMSI.`,
    );
  }

  await humanPause(1500, 2500);
  if (!page.url().includes("/historico")) {
    scrapeLog(`Abrindo histório: ${PAP_HISTORICO}`);
    await page.goto(PAP_HISTORICO, { waitUntil: "domcontentloaded", timeout: 90000 });
    await humanPause(2000, 3000);
    scrapeLog(`Histório aberto: ${page.url()}`, { currentUrl: page.url() });
  } else {
    scrapeLog(`Já no histório: ${page.url()}`, { currentUrl: page.url() });
  }
}

async function openFilters(page: Page) {
  await page.locator(".titulo-filtro").click({ force: true });
  await page.waitForSelector(".MuiDrawer-paper", { state: "visible", timeout: 15000 });
  await humanPause(700, 1200);
}

async function selectTipo(page: Page, tipoLabel: "Interesse" | "Venda") {
  await page
    .locator(".MuiDrawer-paper .filter-select-pdv div[class*='-control']")
    .first()
    .click({ force: true });
  await humanPause(700, 1100);
  await page.getByText(tipoLabel, { exact: true }).click({ force: true });
  await humanPause(1200, 1800);
  const text = await page.locator(".MuiDrawer-paper").innerText();
  const ok =
    tipoLabel === "Interesse" ? /interesse/i.test(text) : /\bvenda\b/i.test(text);
  if (!ok) {
    throw new Error(`Não foi possível selecionar Tipo = ${tipoLabel}.`);
  }
}

/** Status Primário (2º react-select do drawer; não usa filter-select-pdv). */
async function selectStatusPrimario(page: Page, label: string) {
  const drawer = page.locator(".MuiDrawer-paper");
  // Controles: 0=Tipo, 1=Status Primário, 2=Status Secundário
  const controls = drawer.locator("div[class*='-control']");
  const count = await controls.count();
  if (count < 2) {
    throw new Error("Filtro Status Primário não encontrado no drawer.");
  }
  await controls.nth(1).click({ force: true });
  await humanPause(700, 1100);
  const menuOpt = page
    .locator("div[id*='react-select'][id*='option'], div[class*='-option']")
    .filter({ hasText: new RegExp(`^${label}$`, "i") })
    .first();
  if (await menuOpt.count()) {
    await menuOpt.click({ force: true });
  } else {
    await page.keyboard.type(label, { delay: 40 });
    await humanPause(500, 800);
    await page.keyboard.press("Enter");
  }
  await humanPause(1200, 1800);
  const text = await drawer.innerText();
  if (!new RegExp(label.replace(/\s+/g, "\\s+"), "i").test(text)) {
    throw new Error(`Não foi possível selecionar Status Primário = ${label}.`);
  }
}

async function pickCalendarDay(page: Page, label: "De" | "Até", day: number) {
  const root = page
    .locator(".MuiDrawer-paper .MuiTextField-root")
    .filter({ has: page.locator(`label:text-is("${label}")`) });
  await root.locator("button").first().click({ force: true });
  await page.waitForSelector("button.MuiPickersDay-day:not(.MuiPickersDay-hidden)", {
    timeout: 10000,
  });
  await humanPause(500, 900);
  await page
    .locator("button.MuiPickersDay-day:not(.MuiPickersDay-hidden):not(.MuiPickersDay-dayDisabled)")
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .click({ force: true });
  await humanPause(800, 1300);
  return root.locator("input").inputValue();
}

async function applyFilter(page: Page) {
  const btn = page.locator(".MuiDrawer-paper button.btn-filters-new");
  for (let i = 0; i < 20; i++) {
    if (!(await btn.isDisabled())) break;
    await sleep(400);
  }
  await humanPause(900, 1500);
  await btn.click({ force: true });
  await sleep(8000);
  await humanPause(1200, 2000);
}

async function closeDrawer(page: Page) {
  await page
    .locator(".MuiDrawer-paper button#drawer-filter")
    .first()
    .click({ force: true })
    .catch(() => undefined);
  await humanPause(900, 1400);
}

function mapVendaToLead(
  venda: Record<string, unknown>,
  saleType: PapSaleType,
): Omit<MailingLead, "id" | "createdAt" | "updatedAt"> {
  const dados = (venda.dadosCliente || {}) as Record<string, unknown>;
  const contatos = Array.isArray(dados.contatos) ? (dados.contatos as Array<Record<string, unknown>>) : [];
  const phoneRaw = String(contatos[0]?.telefone || contatos[0]?.numero || "");
  const produtos = (venda.produtos || {}) as Record<string, unknown>;
  const banda = (produtos.bandaLarga || {}) as Record<string, unknown>;
  const vendedor = (venda.vendedor || {}) as Record<string, unknown>;
  const enderecos = Array.isArray(venda.enderecos) ? (venda.enderecos as Array<Record<string, unknown>>) : [];
  const end = (enderecos[0] || {}) as Record<string, unknown>;

  const part1: LeadPartData = {
    nome: String(dados.nome || venda.cliente || ""),
    cpf: String(dados.cpf || venda.cpf || ""),
    email: String(dados.email || ""),
    telefone: phoneRaw,
    dataNascimento: String(dados.dataNascimento || ""),
    nomeMae: String(dados.nomeMae || ""),
    genero: String(dados.genero || ""),
    segmento: String(venda.segmento || ""),
    numeroPedido: String(venda.numeroPedido || ""),
    status: String(venda.subStatus || venda.status || ""),
    statusPrimario: String(venda.status || venda.chaveStatusPrimario || ""),
    statusSecundario: String(venda.chaveStatusSecundario || ""),
    motivo: String(venda.motivo || ""),
    etapa: String(venda.etapaInteresse || ""),
    dataCriacao: String(venda.dataCriacao || ""),
  };

  const part2: LeadPartData = {
    endereco: String(end.logradouro || end.endereco || end.rua || ""),
    numero: String(end.numero || ""),
    complemento: String(end.complemento || ""),
    bairro: String(end.bairro || ""),
    cidade: String(end.cidade || end.municipio || ""),
    uf: String(end.uf || end.estado || ""),
    cep: String(end.cep || ""),
    vendedor: String(vendedor.nome || ""),
    matriculaVendedor: String(vendedor.matricula || ""),
    pdv: String(vendedor.pdv || ""),
  };

  const planData: LeadPartData = {
    plano: String(produtos.comboSolicitado || produtos.comboSugerido || venda.plano || ""),
    velocidade: String(banda.velocidade || ""),
    valorPlano: String(produtos.valorPlano || ""),
    taxaHabilitacao: String(produtos.taxaHabilitacao || ""),
    tecnologia: String(produtos.tecnologiaCombo || banda.tipoProduto || ""),
    formaPagamento: String(
      ((venda.pagamento as Record<string, unknown> | undefined)?.formaPagamento as string) || "",
    ),
  };

  return {
    source: "pap",
    queue: "transferir",
    name: part1.nome || "Cliente PAP",
    phone: onlyPhone(phoneRaw) || phoneRaw,
    document: onlyDigits(String(part1.cpf)) || undefined,
    email: part1.email || undefined,
    address: [part2.endereco, part2.numero, part2.bairro].filter(Boolean).join(", ") || undefined,
    city: part2.cidade || undefined,
    state: part2.uf || undefined,
    zip: part2.cep || undefined,
    plan: planData.plano || undefined,
    saleType,
    saleDate: part1.dataCriacao || undefined,
    papId: String(venda._id || venda.numeroPedido || ""),
    part1,
    part2,
    planData,
    raw: venda,
  };
}

async function gotoNextResultsPage(page: Page) {
  const next = page.locator(
    "button[aria-label*='next' i], button[aria-label*='próxim' i], .MuiTablePagination-actions button:last-child, button:has(svg[data-testid='KeyboardArrowRightIcon'])",
  );
  // MUI table pagination usually has two buttons; last enabled is next
  const actions = page.locator(".MuiTablePagination-actions button");
  if (await actions.count()) {
    const last = actions.last();
    if (await last.isDisabled()) return false;
    await humanPause(1200, 2200);
    await last.click({ force: true });
    await sleep(6000);
    await humanPause(1000, 1800);
    return true;
  }
  if (await next.count()) {
    const btn = next.last();
    if (await btn.isDisabled()) return false;
    await humanPause(1200, 2200);
    await btn.click({ force: true });
    await sleep(6000);
    return true;
  }
  return false;
}

export async function runPapHistoricoScrape(options: PapScrapeOptions) {
  const from = parseBrDate(options.dateFrom);
  const to = parseBrDate(options.dateTo);
  if (!from || !to) {
    throw new Error("Datas inválidas. Use dd/mm/aaaa.");
  }

  const saleType = normalizeSaleType(options.saleType);
  const tipoLabel: "Interesse" | "Venda" = saleType === "venda" ? "Venda" : "Interesse";

  const creds = loadPapCredentials();
  if (!creds.email || !creds.password) {
    throw new Error("Credenciais do PAP não configuradas.");
  }

  updateProgress({
    ...defaultScrapeProgress(),
    state: "running",
    message: "Iniciando busca no PAP…",
    logs: [],
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    saleType,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    errors: [],
    page: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    currentUrl: null,
  });
  scrapeLog(
    `Job iniciado · Tipo=${tipoLabel} · Período ${options.dateFrom} → ${options.dateTo}`,
  );

  let browser: Browser | null = null;
  const collected: MailingLead[] = [];
  const seenIds = new Set<string>();

  try {
    scrapeLog("Abrindo Chromium (Playwright)…");
    browser = await launchBrowser();
    // Force Brazil timezone — PAP returns 400 with UTC (+00:00) offsets
    const brContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    });
    const page = await brContext.newPage();
    scrapeLog("Browser pronto (timezone America/Sao_Paulo).");

    const pageBuckets: Array<Record<string, unknown>[]> = [];
    page.on("response", async (res) => {
      try {
        if (!res.url().includes("/api/portal/vendas?") || res.request().method() !== "GET") return;
        if (res.status() !== 200) return;
        const json = (await res.json()) as {
          data?: { vendas?: Record<string, unknown>[]; total?: number };
        };
        const vendas = json?.data?.vendas;
        if (Array.isArray(vendas) && vendas.length) {
          pageBuckets.push(vendas);
          scrapeLog(`API vendas capturada: ${vendas.length} registro(s) nesta resposta.`);
        }
      } catch {
        // ignore parse errors
      }
    });

    await loginPap(page, creds.email, creds.password);

    scrapeLog(`Abrindo filtros · Tipo = ${tipoLabel}`);
    await openFilters(page);
    await selectTipo(page, tipoLabel);
    scrapeLog(`Tipo selecionado: ${tipoLabel}`);

    if (saleType === "venda") {
      scrapeLog(`Selecionando Status Primário = ${STATUS_PRIMARIO_VENDA}`);
      await selectStatusPrimario(page, STATUS_PRIMARIO_VENDA);
      scrapeLog("Status Primário OK (Aguardando tratamento).");
    }

    scrapeLog(`Definindo período ${options.dateFrom} → ${options.dateTo}`);
    const v1 = await pickCalendarDay(page, "De", from.day);
    scrapeLog(`Data De = ${v1}`);
    const v2 = await pickCalendarDay(page, "Até", to.day);
    scrapeLog(`Data Até = ${v2}`);
    if (!v1.includes(String(from.day)) || !v2.includes(String(to.day))) {
      throw new Error(`Falha ao definir datas (De=${v1}, Até=${v2}).`);
    }

    scrapeLog("Aplicando filtros no PAP (aguarde a lista)…");
    pageBuckets.length = 0;
    await applyFilter(page);
    await closeDrawer(page);
    scrapeLog("Filtros aplicados · lendo lista (sem Avançar/Detalhar).");

    // Venda e Interesse: mailing sai da lista (/api/portal/vendas).
    // Não clicar em Detalhar / Avançar — dados já vêm na primeira página da lista.
    const maxPages = options.maxPages ?? 50;
    let pageNo = 1;
    while (pageNo <= maxPages) {
      scrapeLog(
        saleType === "venda"
          ? `Lendo página ${pageNo} (Venda / Aguardando tratamento)…`
          : `Lendo página ${pageNo} de interesses…`,
        { page: pageNo },
      );

      // Wait a bit for response capture
      await sleep(1500);
      const latest = pageBuckets[pageBuckets.length - 1] || [];
      scrapeLog(`Página ${pageNo}: ${latest.length} linha(s) na captura da API.`);
      for (const venda of latest) {
        const papId = String(venda._id || venda.numeroPedido || "");
        if (!papId || seenIds.has(papId)) continue;
        seenIds.add(papId);

        if (saleType === "venda" && !matchesVendaAguardandoTratamento(venda)) {
          const st = String(venda.status || venda.chaveStatusPrimario || "");
          scrapeLog(`Pulando (status ≠ Aguardando tratamento): ${st}`);
          updateProgress({
            skipped: loadScrapeProgress().skipped + 1,
            processed: loadScrapeProgress().processed + 1,
          });
          continue;
        }

        const draft = mapVendaToLead(venda, saleType);
        if (!draft.name || !draft.phone) {
          scrapeLog(
            `Sem nome/telefone — pulando pedido ${String(venda.numeroPedido || papId)}`,
          );
          updateProgress({
            skipped: loadScrapeProgress().skipped + 1,
            processed: loadScrapeProgress().processed + 1,
          });
          continue;
        }
        await updateLeads((leads) => {
          const result = upsertLeadByKey(leads, {
            ...draft,
            id: newId("lead"),
          });
          if (result.created) {
            collected.push(result.lead);
            scrapeLog(
              `Importado: ${result.lead.name} · ${result.lead.part1?.numeroPedido || ""} · ${result.lead.phone}`,
              {
                imported: loadScrapeProgress().imported + 1,
                processed: loadScrapeProgress().processed + 1,
                lastLeadName: result.lead.name,
              },
            );
          } else {
            scrapeLog(`Já existia: ${result.lead.name}`, {
              skipped: loadScrapeProgress().skipped + 1,
              processed: loadScrapeProgress().processed + 1,
              lastLeadName: result.lead.name,
            });
          }
          return result.leads;
        });
        // Pace like a human scanning each row
        await humanPause(400, 900);
      }

      scrapeLog(`Página ${pageNo} concluída · avançando paginação…`);
      const moved = await gotoNextResultsPage(page);
      if (!moved) {
        scrapeLog("Fim da paginação.");
        break;
      }
      pageNo += 1;
    }

    scrapeLog(
      `Concluído: ${loadScrapeProgress().imported} importados, ${loadScrapeProgress().skipped} já existiam/pulados.`,
      {
        state: "done",
        finishedAt: new Date().toISOString(),
      },
    );

    await brContext.close();
    return {
      imported: loadScrapeProgress().imported,
      skipped: loadScrapeProgress().skipped,
      processed: loadScrapeProgress().processed,
      leads: collected,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = loadScrapeProgress();
    scrapeLog(`ERRO: ${message}`, {
      state: "error",
      finishedAt: new Date().toISOString(),
      errors: [...current.errors, message].slice(-20),
    });
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function yesterdayBrDate() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA => YYYY-MM-DD
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export { savePapCredentials, loadPapCredentials };
