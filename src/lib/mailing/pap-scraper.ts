import fs from "node:fs";
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
import { resolveMailingPlanLabel } from "@/lib/mailing/plan-map";
import type { LeadPartData, MailingLead, ScrapeProgress } from "@/lib/mailing/types";
import { ensureDataDirs, MAILING_LIVE_DIR, MAILING_LIVE_SHOT } from "@/lib/paths";

const PAP_HOME = "https://pap.niointernet.com.br/";
const PAP_HISTORICO = "https://pap.niointernet.com.br/administrativo/historico";

const globalScrapeCtl = globalThis as typeof globalThis & {
  mailingScrapeCancelRequested?: boolean;
  mailingScrapeBrowser?: Browser | null;
};

export class ScrapeCancelledError extends Error {
  constructor(message = "Busca cancelada pelo usuário.") {
    super(message);
    this.name = "ScrapeCancelledError";
  }
}

export function requestCancelScrape() {
  globalScrapeCtl.mailingScrapeCancelRequested = true;
  const browser = globalScrapeCtl.mailingScrapeBrowser;
  if (browser) {
    void browser.close().catch(() => undefined);
  }
}

export function clearCancelScrape() {
  globalScrapeCtl.mailingScrapeCancelRequested = false;
}

export function isScrapeCancelRequested() {
  return Boolean(globalScrapeCtl.mailingScrapeCancelRequested);
}

function assertNotCancelled() {
  if (isScrapeCancelRequested()) {
    throw new ScrapeCancelledError();
  }
}

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

function formatBrDate(parts: { day: number; month: number; year: number }) {
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  return `${dd}/${mm}/${parts.year}`;
}

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

function parsePtMonthYear(text: string): { month: number; year: number } | null {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const m = normalized.match(
    /(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{4})/,
  );
  if (!m) return null;
  const names = MONTHS_PT.map((n) => n.normalize("NFD").replace(/\p{M}/gu, ""));
  const month = names.indexOf(m[1]!) + 1;
  const year = Number(m[2]);
  if (month < 1 || !year) return null;
  return { month, year };
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

let liveShotBusy = false;

/** Grava print do browser em data/mailing/live/live.png para o painel ao vivo. */
async function captureLiveShot(page: Page, label: string) {
  if (liveShotBusy) return;
  liveShotBusy = true;
  try {
    ensureDataDirs();
    fs.mkdirSync(MAILING_LIVE_DIR, { recursive: true });
    await page.screenshot({
      path: MAILING_LIVE_SHOT,
      type: "png",
      fullPage: false,
      timeout: 8000,
    });
    updateProgress({
      liveShotLabel: label,
      liveShotAt: new Date().toISOString(),
      currentUrl: page.url(),
    });
  } catch {
    // página pode ter fechado no cancel — ignora
  } finally {
    liveShotBusy = false;
  }
}

function startLiveShotLoop(page: Page) {
  const timer = setInterval(() => {
    if (isScrapeCancelRequested()) {
      clearInterval(timer);
      return;
    }
    void captureLiveShot(page, "ao-vivo");
  }, 1800);
  return timer;
}

function isOnPap(url: string) {
  return /pap\.niointernet\.com\.br/i.test(url) && !/login\.microsoftonline|microsoft\.com\/login/i.test(url);
}

async function loginPap(page: Page, email: string, password: string) {
  scrapeLog(`Abrindo PAP: ${PAP_HOME}`, { currentUrl: PAP_HOME });
  await page.goto(PAP_HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
  scrapeLog(`Página carregada: ${page.url()}`, { currentUrl: page.url() });
  await captureLiveShot(page, "pap-home");

  scrapeLog("Aguardando campo de e-mail Microsoft…");
  await page.waitForSelector("#i0116", { timeout: 45000 });
  await humanPause(600, 1000);
  scrapeLog(`Preenchendo e-mail: ${email}`);
  await page.fill("#i0116", email);
  await captureLiveShot(page, "login-email");
  await humanPause(350, 650);
  scrapeLog("Clicando Avançar (e-mail)…");
  await page.click("#idSIButton9");

  scrapeLog("Aguardando campo de senha…");
  await page.waitForSelector("#i0118", { state: "visible", timeout: 45000 });
  await humanPause(800, 1300);
  scrapeLog(`Preenchendo senha (${password.length} caracteres)…`);
  const passInput = page.locator("#i0118");
  await passInput.click({ force: true });
  await passInput.fill("");
  await passInput.pressSequentially(password, { delay: 35 });
  const typedLen = await passInput.inputValue().then((v) => v.length).catch(() => 0);
  scrapeLog(`Senha digitada · ${typedLen}/${password.length} caracteres no campo.`);
  if (typedLen !== password.length) {
    scrapeLog("Retry fill() na senha (pressSequentially incompleto)…");
    await passInput.fill(password);
  }
  await captureLiveShot(page, "login-senha");
  await humanPause(350, 650);
  scrapeLog("Clicando Entrar (senha)…");
  await page.click("#idSIButton9");
  await sleep(2000);
  await captureLiveShot(page, "pos-senha");

  // Não usar waitForURL(..., load): SPA Microsoft/PAP muitas vezes não dispara "load".
  const deadline = Date.now() + 120_000;
  let lastLoggedUrl = "";
  while (Date.now() < deadline) {
    assertNotCancelled();
    const url = page.url();
    if (url !== lastLoggedUrl) {
      scrapeLog(`Login: URL = ${url}`, { currentUrl: url });
      lastLoggedUrl = url;
    }

    if (isOnPap(url)) {
      scrapeLog("Login Microsoft OK — entrou no PAP.");
      break;
    }

    const pwdError = page.locator("#passwordError, #usernameError, #errorText");
    if (await pwdError.count()) {
      const visible = await pwdError.first().isVisible().catch(() => false);
      const errText = ((await pwdError.first().innerText().catch(() => "")) || "").trim();
      if (visible && errText && /incorret|inválid|invalid|não foi possível|locked|bloquead/i.test(errText)) {
        // Confirma por 2s (evita falso positivo de texto residual)
        await sleep(2000);
        const still = ((await pwdError.first().innerText().catch(() => "")) || "").trim();
        if (still) {
          throw new Error(`Login Microsoft recusado: ${still}`);
        }
      }
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
  const control = page
    .locator(".MuiDrawer-paper .filter-select-pdv div[class*='-control']")
    .first();
  const current = (
    (await page
      .locator(".MuiDrawer-paper .filter-select-pdv div[class*='-singleValue']")
      .first()
      .innerText()
      .catch(() => "")) || ""
  ).trim();
  if (new RegExp(`^${tipoLabel}$`, "i").test(current)) {
    scrapeLog(`Tipo já está em ${tipoLabel} — sem reabrir o select.`);
    return;
  }

  await control.click({ force: true });
  await humanPause(700, 1100);
  // Clica só a opção do menu (não o singleValue já visível — evita strict mode)
  const menuOpt = page
    .locator(
      "div[id*='react-select'][id*='option'], div[class*='-menu'] div[class*='-option'], div[class*='-option']",
    )
    .filter({ hasText: new RegExp(`^${tipoLabel}$`, "i") })
    .first();
  if (!(await menuOpt.count())) {
    throw new Error(`Opção Tipo = ${tipoLabel} não apareceu no menu.`);
  }
  await menuOpt.click({ force: true });
  await humanPause(1200, 1800);
  const selected = (
    (await page
      .locator(".MuiDrawer-paper .filter-select-pdv div[class*='-singleValue']")
      .first()
      .innerText()
      .catch(() => "")) || ""
  ).trim();
  if (!new RegExp(`^${tipoLabel}$`, "i").test(selected)) {
    throw new Error(
      `Não foi possível selecionar Tipo = ${tipoLabel} (ficou "${selected || "vazio"}").`,
    );
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

async function readOpenCalendarMonthYear(page: Page) {
  const header = page.locator(
    ".MuiPopover-paper .MuiPickersCalendarHeader-transitionContainer p, .MuiPickersCalendarHeader-transitionContainer p, .MuiPickersCalendarHeader-switchHeader p",
  );
  if (!(await header.count())) return null;
  const text = (await header.first().innerText().catch(() => "")) || "";
  return parsePtMonthYear(text);
}

const DATE_DAY_SELECTOR =
  ".MuiPopover-paper button.MuiPickersDay-day:not(.MuiPickersDay-hidden), .MuiPickersBasePicker-container button.MuiPickersDay-day:not(.MuiPickersDay-hidden)";

async function ensureFiltersOpen(page: Page) {
  const drawer = page.locator(".MuiDrawer-paper");
  if (await drawer.isVisible().catch(() => false)) return;
  scrapeLog("Drawer de filtros fechou — reabrindo…");
  await openFilters(page);
}

/** Fecha só o popover do DatePicker. NÃO usa Escape no escuro — isso fecha o drawer. */
async function closeAnyDatePopover(page: Page) {
  const openDays = page.locator(DATE_DAY_SELECTOR);
  if (!(await openDays.count())) return;
  // Backdrop transparente do MUI Popover
  const backdrop = page.locator(".MuiPopover-root > div[aria-hidden='true'], .MuiBackdrop-root").first();
  if (await backdrop.count()) {
    await backdrop.click({ force: true }).catch(() => undefined);
    await sleep(250);
  }
  if (await openDays.first().isVisible().catch(() => false)) {
    // Escape só com popover aberto (fecha o picker, não o drawer)
    await page.keyboard.press("Escape").catch(() => undefined);
    await sleep(250);
  }
  await ensureFiltersOpen(page);
}

async function openDatePopover(page: Page, root: ReturnType<Page["locator"]>) {
  await ensureFiltersOpen(page);
  await closeAnyDatePopover(page);
  await root.scrollIntoViewIfNeeded().catch(() => undefined);

  const calendarBtn = root.locator(".MuiInputAdornment-root button").first();
  const strategies: Array<() => Promise<void>> = [
    async () => {
      await calendarBtn.click({ force: true });
    },
    async () => {
      await root.locator("input").first().click({ force: true });
      await humanPause(200, 350);
      await calendarBtn.click({ force: true });
    },
    async () => {
      // Clique no SVG do calendário
      await root.locator(".MuiInputAdornment-root svg").first().click({ force: true });
    },
  ];

  let lastErr: unknown;
  for (let i = 0; i < strategies.length; i++) {
    try {
      await ensureFiltersOpen(page);
      await strategies[i]!();
      await page.waitForSelector(DATE_DAY_SELECTOR, { state: "visible", timeout: 6000 });
      await humanPause(350, 600);
      return;
    } catch (err) {
      lastErr = err;
      scrapeLog(`Calendário: abertura tentativa ${i + 1}/${strategies.length} falhou — retry…`);
      await closeAnyDatePopover(page);
      await humanPause(200, 400);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Não foi possível abrir o calendário do DatePicker.");
}

async function setDateByTyping(
  page: Page,
  root: ReturnType<Page["locator"]>,
  expected: string,
) {
  await ensureFiltersOpen(page);
  await closeAnyDatePopover(page);
  const input = root.locator("input").first();
  await input.scrollIntoViewIfNeeded().catch(() => undefined);
  await input.click({ force: true });
  await humanPause(200, 400);
  // KeyboardDatePicker do MUI v4: setter nativo + eventos React
  await input.evaluate((el, v) => {
    const node = el as HTMLInputElement;
    node.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(node, "");
    node.dispatchEvent(new Event("input", { bubbles: true }));
    setter?.call(node, v);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.blur();
  }, expected);
  await humanPause(400, 700);
  let value = (await input.inputValue()).trim();
  if (value === expected) return value;

  // Fallback: digitar caractere a caractere (máscara dd/mm/yyyy)
  await input.click({ force: true });
  await page.keyboard.press("Control+a");
  await sleep(80);
  await page.keyboard.press("Backspace");
  await sleep(100);
  await input.pressSequentially(expected, { delay: 45 });
  await page.keyboard.press("Tab");
  await humanPause(500, 800);
  value = (await input.inputValue()).trim();
  await ensureFiltersOpen(page);
  return value;
}

/**
 * Seleciona data completa no MUI DatePicker do drawer (não só o dia do mês aberto).
 * Ex.: 17/09/2026 navega até setembro/2026 e só então clica o dia 17.
 */
async function pickCalendarDate(
  page: Page,
  label: "De" | "Até",
  parts: { day: number; month: number; year: number },
) {
  const expected = formatBrDate(parts);
  await ensureFiltersOpen(page);
  const root = page
    .locator(".MuiDrawer-paper .MuiTextField-root")
    .filter({ has: page.locator(`label:text-is("${label}")`) });
  const input = root.locator("input").first();

  // 1) Digitar primeiro (sem Escape cego — senão o drawer fecha)
  scrapeLog(`Definindo ${label} = ${expected}…`);
  const typed = await setDateByTyping(page, root, expected);
  if (typed === expected) {
    scrapeLog(`Campo ${label} digitado: ${typed}`);
    return typed;
  }
  scrapeLog(
    `Campo ${label} não aceitou digitação (${typed || "vazio"}) — usando calendário…`,
  );

  // 2) Fallback: calendário com navegação de mês/ano
  try {
    await openDatePopover(page, root);

    const targetIndex = parts.year * 12 + (parts.month - 1);
    for (let i = 0; i < 36; i++) {
      assertNotCancelled();
      const current = await readOpenCalendarMonthYear(page);
      if (!current) break;
      const currentIndex = current.year * 12 + (current.month - 1);
      if (currentIndex === targetIndex) break;

      const buttons = page.locator(
        ".MuiPopover-paper .MuiPickersCalendarHeader-switchHeader button.MuiPickersCalendarHeader-iconButton, .MuiPickersCalendarHeader-switchHeader button.MuiPickersCalendarHeader-iconButton",
      );
      const goPrev = currentIndex > targetIndex;
      const btn = goPrev ? buttons.first() : buttons.nth(1);
      if (await btn.isDisabled().catch(() => true)) {
        throw new Error(
          `Calendário ${label}: não foi possível navegar até ${expected} (mês aberto: ${current.month}/${current.year}).`,
        );
      }
      scrapeLog(
        `Calendário ${label}: ${MONTHS_PT[current.month - 1]} ${current.year} → ${goPrev ? "mês anterior" : "próximo mês"}`,
      );
      await btn.click({ force: true });
      await humanPause(350, 600);
    }

    const opened = await readOpenCalendarMonthYear(page);
    if (!opened || opened.month !== parts.month || opened.year !== parts.year) {
      throw new Error(
        `Calendário ${label}: esperado ${parts.month}/${parts.year}, aberto ${opened?.month || "?"}/${opened?.year || "?"}.`,
      );
    }

    await page
      .locator(
        ".MuiPopover-paper button.MuiPickersDay-day:not(.MuiPickersDay-hidden):not(.MuiPickersDay-dayDisabled)",
      )
      .filter({ hasText: new RegExp(`^${parts.day}$`) })
      .first()
      .click({ force: true });
    await humanPause(800, 1300);
    await ensureFiltersOpen(page);

    const value = (await input.inputValue()).trim();
    if (value === expected) {
      scrapeLog(`Campo ${label} confirmado no calendário: ${value}`);
      return value;
    }
    scrapeLog(`Calendário ${label} deixou valor "${value || "vazio"}" (esperado ${expected}).`);
    throw new Error(
      `Data ${label} divergente: esperado ${expected}, campo ficou ${value || "(vazio)"}.`,
    );
  } catch (err) {
    await closeAnyDatePopover(page);
    throw err instanceof Error
      ? err
      : new Error(`Data ${label} não aplicada. Esperado ${expected}.`);
  }
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

  const planoRaw = String(
    produtos.comboSolicitado || produtos.comboSugerido || venda.plano || "",
  );
  const velocidadeRaw = String(banda.velocidade || "");
  const valorPlanoRaw = String(
    produtos.valorPlano ||
      produtos.valor ||
      (produtos.preco as string | undefined) ||
      "",
  );
  // Regra comercial: valor → 600 mega / 800 mega / 1GB
  const planLabel = resolveMailingPlanLabel({
    valorPlano: valorPlanoRaw,
    plano: planoRaw,
    velocidade: velocidadeRaw,
  });

  const planData: LeadPartData = {
    plano: planLabel || planoRaw,
    planoOriginal: planoRaw,
    velocidade: planLabel || velocidadeRaw,
    valorPlano: valorPlanoRaw,
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
    plan: planLabel || planoRaw || undefined,
    saleType,
    saleDate: part1.dataCriacao || undefined,
    papId: String(venda._id || venda.numeroPedido || ""),
    part1,
    part2,
    planData,
    raw: venda,
  };
}

/**
 * Avança UMA página (seta >), nunca a última (seta >|).
 * MUI TablePagination com first/last: [primeira, anterior, próxima, última].
 */
async function resolveNextPageButton(page: Page) {
  const actions = page.locator(".MuiTablePagination-actions button");
  const count = await actions.count();

  const byIcon = page
    .locator(".MuiTablePagination-actions button")
    .filter({
      has: page.locator(
        "svg[data-testid='KeyboardArrowRightIcon'], svg[data-testid='NavigateNextIcon']",
      ),
    })
    .first();
  if (await byIcon.count()) return byIcon;

  const byAria = page.locator(
    [
      ".MuiTablePagination-actions button[aria-label='next page']",
      ".MuiTablePagination-actions button[aria-label='Next page']",
      ".MuiTablePagination-actions button[aria-label='próxima página']",
      ".MuiTablePagination-actions button[aria-label='Próxima página']",
      ".MuiTablePagination-actions button[aria-label='Go to next page']",
    ].join(", "),
  );
  if (await byAria.count()) return byAria.first();

  // Posição: 4 botões → índice 2 (próxima); 2 botões → índice 1 (próxima).
  // Nunca actions.last() quando há 4 — isso é a ÚLTIMA página (>|).
  if (count >= 4) return actions.nth(2);
  if (count === 2) return actions.nth(1);
  if (count === 1) return actions.first();
  return null;
}

async function gotoNextResultsPage(page: Page) {
  await humanPause(800, 1400);

  const nextBtn = await resolveNextPageButton(page);
  if (!nextBtn) {
    scrapeLog("Botão próxima página (>) não encontrado.");
    return false;
  }

  const label = (
    (await nextBtn.getAttribute("aria-label").catch(() => "")) || ""
  ).toLowerCase();
  if (/last|última|ultima/.test(label)) {
    scrapeLog(
      `Paginação: recusei clique em "${label || "última"}" — preciso da seta >.`,
    );
    return false;
  }

  if (await nextBtn.isDisabled().catch(() => true)) {
    scrapeLog("Botão próxima página (>) desabilitado — fim da lista.");
    return false;
  }

  scrapeLog(
    `Clicando seta próxima página (>) ${label ? `[${label}] ` : ""}— uma página por vez…`,
  );
  await nextBtn.click({ force: true });
  await sleep(6000);
  await humanPause(1000, 1800);
  return true;
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

  clearCancelScrape();
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
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  const collected: MailingLead[] = [];
  const seenIds = new Set<string>();

  try {
    scrapeLog("Abrindo Chromium (Playwright)…");
    assertNotCancelled();
    browser = await launchBrowser();
    globalScrapeCtl.mailingScrapeBrowser = browser;
    // Force Brazil timezone — PAP returns 400 with UTC (+00:00) offsets
    const brContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    });
    const page = await brContext.newPage();
    scrapeLog("Browser pronto (timezone America/Sao_Paulo) — tela ao vivo ligada.");
    liveTimer = startLiveShotLoop(page);

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
          void captureLiveShot(page, "api-vendas");
        }
      } catch {
        // ignore parse errors
      }
    });

    assertNotCancelled();
    await loginPap(page, creds.email, creds.password);
    await captureLiveShot(page, "historico");
    assertNotCancelled();

    scrapeLog(`Abrindo filtros · Tipo = ${tipoLabel}`);
    await openFilters(page);
    await captureLiveShot(page, "filtros-abertos");
    assertNotCancelled();
    await selectTipo(page, tipoLabel);
    scrapeLog(`Tipo selecionado: ${tipoLabel}`);
    await captureLiveShot(page, `tipo-${tipoLabel.toLowerCase()}`);

    if (saleType === "venda") {
      assertNotCancelled();
      scrapeLog(`Selecionando Status Primário = ${STATUS_PRIMARIO_VENDA}`);
      await selectStatusPrimario(page, STATUS_PRIMARIO_VENDA);
      scrapeLog("Status Primário OK (Aguardando tratamento).");
      await captureLiveShot(page, "status-aguardando");
    }

    assertNotCancelled();
    scrapeLog(`Definindo período exatamente como na tela: ${options.dateFrom} → ${options.dateTo}`);
    const v1 = await pickCalendarDate(page, "De", from);
    scrapeLog(`Data De = ${v1}`);
    await captureLiveShot(page, "data-de");
    assertNotCancelled();
    const v2 = await pickCalendarDate(page, "Até", to);
    scrapeLog(`Data Até = ${v2}`);
    await captureLiveShot(page, "data-ate");
    if (v1.trim() !== options.dateFrom.trim() || v2.trim() !== options.dateTo.trim()) {
      throw new Error(
        `Datas não bateram com o formulário (pedido ${options.dateFrom}→${options.dateTo}, PAP De=${v1}, Até=${v2}).`,
      );
    }

    assertNotCancelled();
    scrapeLog("Aplicando filtros no PAP (aguarde a lista)…");
    pageBuckets.length = 0;
    await applyFilter(page);
    await captureLiveShot(page, "filtrando");
    await closeDrawer(page);
    await captureLiveShot(page, "lista");
    scrapeLog("Filtros aplicados · lendo lista (sem Avançar/Detalhar).");

    // Venda e Interesse: mailing sai da lista (/api/portal/vendas).
    // Não clicar em Detalhar / Avançar — dados já vêm na primeira página da lista.
    // Paginação: sempre seta > (próxima), nunca >| (última). Limite alto p/ listas grandes.
    const maxPages = options.maxPages ?? 2000;
    let pageNo = 1;
    let consumedBuckets = 0;
    while (pageNo <= maxPages) {
      assertNotCancelled();
      scrapeLog(
        saleType === "venda"
          ? `Lendo página ${pageNo} (Venda / Aguardando tratamento)…`
          : `Lendo página ${pageNo} de interesses…`,
        { page: pageNo },
      );

      // Espera captura da API desta página (novo bucket após Filtrar / próxima)
      for (let w = 0; w < 20 && pageBuckets.length <= consumedBuckets; w++) {
        await sleep(500);
      }
      const latest =
        pageBuckets.length > consumedBuckets
          ? pageBuckets[pageBuckets.length - 1] || []
          : pageBuckets[pageBuckets.length - 1] || [];
      consumedBuckets = pageBuckets.length;
      scrapeLog(`Página ${pageNo}: ${latest.length} linha(s) na captura da API.`);
      await captureLiveShot(page, `pagina-${pageNo}`);
      for (const venda of latest) {
        assertNotCancelled();
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
          // Venda: importa mesmo com CPF já cadastrado (pedido/papId ainda deduplica)
          const result = upsertLeadByKey(
            leads,
            {
              ...draft,
              id: newId("lead"),
            },
            { allowDuplicateCpf: saleType === "venda" },
          );
          if (result.skipped && result.skipReason === "cpf") {
            scrapeLog(
              `Ignorado CPF já cadastrado: ${draft.name} · CPF ${draft.document || "—"} · pedido ${draft.part1?.numeroPedido || ""}`,
              {
                skipped: loadScrapeProgress().skipped + 1,
                processed: loadScrapeProgress().processed + 1,
                lastLeadName: draft.name,
              },
            );
          } else if (result.created) {
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
            scrapeLog(`Já existia (sem novo CPF): ${result.lead.name}`, {
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
      if (pageNo >= maxPages) {
        scrapeLog(`Limite de ${maxPages} páginas atingido — parei a paginação.`);
        break;
      }
      const bucketsBeforeNext = pageBuckets.length;
      const moved = await gotoNextResultsPage(page);
      if (!moved) {
        scrapeLog("Fim da paginação.");
        break;
      }
      // Garante que a próxima iteração use a resposta da nova página
      for (let w = 0; w < 24 && pageBuckets.length <= bucketsBeforeNext; w++) {
        await sleep(500);
      }
      if (pageBuckets.length <= bucketsBeforeNext) {
        scrapeLog(
          "Paginação: cliquei > mas a API não devolveu página nova — encerrando.",
        );
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
    const cancelled =
      error instanceof ScrapeCancelledError ||
      isScrapeCancelRequested() ||
      (error instanceof Error && /Target (page|context|browser) has been closed|cancelled|cancelad/i.test(error.message));
    const message = cancelled
      ? "Busca interrompida. Ajuste data/tipo e clique em Buscar novamente."
      : error instanceof Error
        ? error.message
        : String(error);
    const current = loadScrapeProgress();
    scrapeLog(cancelled ? `PARADO: ${message}` : `ERRO: ${message}`, {
      state: cancelled ? "cancelled" : "error",
      finishedAt: new Date().toISOString(),
      errors: cancelled ? current.errors : [...current.errors, message].slice(-20),
    });
    if (!cancelled) throw error;
    return {
      imported: loadScrapeProgress().imported,
      skipped: loadScrapeProgress().skipped,
      processed: loadScrapeProgress().processed,
      leads: collected,
      cancelled: true,
    };
  } finally {
    if (liveTimer) clearInterval(liveTimer);
    globalScrapeCtl.mailingScrapeBrowser = null;
    clearCancelScrape();
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
