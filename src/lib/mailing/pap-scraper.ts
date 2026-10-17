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
  saveScrapeProgress(next);
  return next;
}

async function loginPap(page: Page, email: string, password: string) {
  await page.goto(PAP_HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#i0116", { timeout: 30000 });
  await humanPause(600, 1000);
  await page.fill("#i0116", email);
  await humanPause(350, 650);
  await page.click("#idSIButton9");
  await page.waitForSelector("#i0118", { state: "visible", timeout: 30000 });
  await humanPause(800, 1300);
  await page.fill("#i0118", password);
  await humanPause(350, 650);
  await page.click("#idSIButton9");
  await sleep(2500);
  for (let i = 0; i < 5; i++) {
    if (page.url().includes("pap.niointernet.com.br") && !page.url().includes("microsoft")) break;
    if (await page.locator("#idSIButton9").count()) {
      await page.click("#idSIButton9");
      await sleep(3000);
    } else {
      await sleep(1500);
    }
  }
  await page.waitForURL(/pap\.niointernet\.com\.br/, { timeout: 60000 });
  await humanPause(1800, 2800);
  if (!page.url().includes("/historico")) {
    await page.goto(PAP_HISTORICO, { waitUntil: "domcontentloaded", timeout: 60000 });
    await humanPause(2000, 3000);
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
    message: "Abrindo PAP e autenticando…",
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
  });

  let browser: Browser | null = null;
  const collected: MailingLead[] = [];
  const seenIds = new Set<string>();

  try {
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
        }
      } catch {
        // ignore parse errors
      }
    });

    updateProgress({ message: "Login Microsoft / PAP…" });
    await loginPap(page, creds.email, creds.password);

    updateProgress({ message: `Abrindo filtros (Tipo = ${tipoLabel})…` });
    await openFilters(page);
    await selectTipo(page, tipoLabel);

    if (saleType === "venda") {
      updateProgress({
        message: `Status Primário = ${STATUS_PRIMARIO_VENDA}…`,
      });
      await selectStatusPrimario(page, STATUS_PRIMARIO_VENDA);
    }

    updateProgress({
      message: `Definindo período ${options.dateFrom} → ${options.dateTo}…`,
    });
    const v1 = await pickCalendarDay(page, "De", from.day);
    const v2 = await pickCalendarDay(page, "Até", to.day);
    if (!v1.includes(String(from.day)) || !v2.includes(String(to.day))) {
      throw new Error(`Falha ao definir datas (De=${v1}, Até=${v2}).`);
    }

    updateProgress({ message: "Filtrando no PAP (aguarde)…" });
    pageBuckets.length = 0;
    await applyFilter(page);
    await closeDrawer(page);

    // Venda e Interesse: mailing sai da lista (/api/portal/vendas).
    // Não clicar em Detalhar / Avançar — dados já vêm na primeira página da lista.
    const maxPages = options.maxPages ?? 50;
    let pageNo = 1;
    while (pageNo <= maxPages) {
      updateProgress({
        page: pageNo,
        message:
          saleType === "venda"
            ? `Lendo página ${pageNo} (Venda / Aguardando tratamento, sem Avançar)…`
            : `Lendo página ${pageNo} de interesses…`,
      });

      // Wait a bit for response capture
      await sleep(1500);
      const latest = pageBuckets[pageBuckets.length - 1] || [];
      for (const venda of latest) {
        const papId = String(venda._id || venda.numeroPedido || "");
        if (!papId || seenIds.has(papId)) continue;
        seenIds.add(papId);

        if (saleType === "venda" && !matchesVendaAguardandoTratamento(venda)) {
          updateProgress({
            skipped: loadScrapeProgress().skipped + 1,
            processed: loadScrapeProgress().processed + 1,
          });
          continue;
        }

        const draft = mapVendaToLead(venda, saleType);
        if (!draft.name || !draft.phone) {
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
            updateProgress({
              imported: loadScrapeProgress().imported + 1,
              processed: loadScrapeProgress().processed + 1,
              lastLeadName: result.lead.name,
            });
          } else {
            updateProgress({
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

      const moved = await gotoNextResultsPage(page);
      if (!moved) break;
      pageNo += 1;
      // clear bucket marker by pushing empty sentinel awareness — next response appends
    }

    updateProgress({
      state: "done",
      message: `Concluído: ${loadScrapeProgress().imported} importados, ${loadScrapeProgress().skipped} já existiam.`,
      finishedAt: new Date().toISOString(),
    });

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
    updateProgress({
      state: "error",
      message,
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
