import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log, setStep } from "@/lib/store";
import {
  CPF_REGEX,
  formatCpf,
  isValidCpf,
  matchCrmStatus,
  normalizeText,
  onlyDigits,
  type CrmStatus,
} from "@/lib/text";

const CRM_LOGIN = "https://uniktelecom.com.br/proadmin/login.php";
const CRM_BASE = "https://uniktelecom.com.br/proadmin";

const CRM_LISTS = [
  {
    label: "NIO Pré-Venda",
    url: `${CRM_BASE}/consultarPrevendas.php?active=prevendas8&operadora=8`,
  },
  {
    label: "TIM FIBRA Pré-Venda",
    url: `${CRM_BASE}/consultarPrevendas.php?active=prevendas7&operadora=7`,
  },
  {
    label: "NIO Histórico",
    url: `${CRM_BASE}/consultarHistoricos.php?active=historicos8&operadora=8`,
  },
  {
    label: "TIM FIBRA Histórico",
    url: `${CRM_BASE}/consultarHistoricos.php?active=historicos7&operadora=7`,
  },
];

const STATUS_QUERY: Record<CrmStatus, string> = {
  "aguardando biometria": "AGUARDANDO BIOMETRIA",
  "cancelado/bio expirada": "CANCELADO/BIO EXPIRADA",
};

export type CrmLead = {
  name: string;
  cpf: string;
  crmStatus: CrmStatus;
};

function uniqueLeads(leads: CrmLead[]) {
  const map = new Map<string, CrmLead>();
  for (const lead of leads) {
    const key = `${lead.crmStatus}:${onlyDigits(lead.cpf)}`;
    if (!map.has(key)) map.set(key, lead);
  }
  return [...map.values()];
}

function guessName(rowText: string) {
  const lines = rowText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !CPF_REGEX.test(line))
    .filter((line) => !/^#\d+/.test(line))
    .filter((line) => !/^\d{2}\/\d{2}\/\d{4}/.test(line))
    .filter((line) => !/^P\./i.test(line))
    .filter((line) => !/cep:|end\.|bairro:|class\.|plano:|pag:|venc/i.test(line))
    .filter((line) => !matchCrmStatus(line))
    .filter((line) => /[a-zA-ZÀ-ú]{3,}/.test(line));
  return lines[0]?.slice(0, 80) || "Cliente CRM";
}

function extractLeadsFromText(text: string, status: CrmStatus): CrmLead[] {
  const leads: CrmLead[] = [];
  const chunks = text.split(/\n(?=#\d+)/);
  const blocks = chunks.length > 1 ? chunks : text.split(/\n{2,}/);
  for (const block of blocks) {
    if (matchCrmStatus(block) !== status && !normalizeText(block).includes(normalizeText(STATUS_QUERY[status]))) {
      continue;
    }
    const matches = block.match(CPF_REGEX) ?? [];
    for (const raw of matches) {
      if (!isValidCpf(raw)) continue;
      leads.push({
        name: guessName(block),
        cpf: formatCpf(raw),
        crmStatus: status,
      });
    }
  }
  return uniqueLeads(leads);
}

async function waitForTable(page: Page) {
  await page
    .locator("#table_default, table.dataTable, table")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => undefined);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  await page.waitForTimeout(800);
}

async function applySearch(page: Page, query: string) {
  const search = page.locator(".dataTables_filter input, #table_default_filter input").first();
  if (!(await search.count())) return false;
  await search.click({ timeout: 4000 }).catch(() => undefined);
  await search.fill("");
  await search.fill(query);
  await page.waitForTimeout(2200);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  return true;
}

async function showHundredRows(page: Page) {
  const lengthSelect = page.locator("select[name$='_length']").first();
  if (await lengthSelect.count()) {
    await lengthSelect.selectOption("100").catch(() => undefined);
    await page.waitForTimeout(1500);
    await page
      .locator(".dataTables_processing")
      .waitFor({ state: "hidden", timeout: 15000 })
      .catch(() => undefined);
  }
}

async function gotoNextPage(page: Page) {
  const next = page.locator("#table_default_next, a.paginate_button.next, a:has-text('Próxima')").first();
  if (!(await next.count())) return false;
  const className = (await next.getAttribute("class")) ?? "";
  if (/\bdisabled\b/i.test(className)) return false;
  await next.click({ timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(1600);
  await page
    .locator(".dataTables_processing")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => undefined);
  return !/\bdisabled\b/i.test((await next.getAttribute("class")) ?? "");
}

async function extractFromTable(page: Page, status: CrmStatus): Promise<CrmLead[]> {
  const rows = page.locator("#table_default tbody tr, table.dataTable tbody tr");
  const count = await rows.count();
  const leads: CrmLead[] = [];
  for (let i = 0; i < count; i += 1) {
    const rowText = (await rows.nth(i).innerText().catch(() => "")) || "";
    if (!rowText.trim() || /nenhum (dado|registro)/i.test(rowText)) continue;
    const statusInRow = matchCrmStatus(rowText);
    if (statusInRow && statusInRow !== status) continue;
    if (!statusInRow && !normalizeText(rowText).includes(normalizeText(STATUS_QUERY[status]))) {
      continue;
    }
    const cpfNode = rows.nth(i).locator(".cpf");
    let raw = ((await cpfNode.first().innerText().catch(() => "")) || "").trim();
    if (!raw) {
      raw = rowText.match(CPF_REGEX)?.[0] ?? "";
    }
    if (!isValidCpf(raw)) continue;
    leads.push({
      name: guessName(rowText),
      cpf: formatCpf(raw),
      crmStatus: status,
    });
  }
  if (leads.length) return uniqueLeads(leads);
  return extractLeadsFromText(await visibleText(page), status);
}

export async function loginCrm(page: Page, user: string, pass: string) {
  setStep("Entrando no CRM Unik...");
  await page.goto(CRM_LOGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
  await fillFirst(page, ['input[name="usuario"]', 'input[placeholder="Usuario"]'], user);
  await fillFirst(page, ['input[name="senha"]', 'input[type="password"]'], pass);
  await screenshot(page, "crm-login");
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    clickFirst(page, ['button[type="submit"]', 'button:has-text("Entrar")']),
  ]);
  await page.waitForTimeout(2000);
  await screenshot(page, "crm-pos-login");
  if (page.url().includes("login.php")) {
    const body = await visibleText(page);
    if (/dados incorretos|acesso negado|senha/i.test(body)) {
      throw new Error("CRM recusou o login. Confira usuário e senha.");
    }
    throw new Error("CRM permaneceu na tela de login. Confira as credenciais.");
  }
  log("info", `CRM autenticado em ${page.url()}`);
}

export async function collectCrmLeads(page: Page): Promise<CrmLead[]> {
  setStep("Lendo Pré-Venda e Histórico (NIO e TIM FIBRA)...");
  const found: CrmLead[] = [];
  const statuses: CrmStatus[] = ["aguardando biometria", "cancelado/bio expirada"];

  for (const list of CRM_LISTS) {
    setStep(`Abrindo ${list.label}...`);
    log("info", `CRM: abrindo ${list.label}`);
    await page.goto(list.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForTable(page);
    await showHundredRows(page);

    for (const status of statuses) {
      setStep(`${list.label}: ${status}`);
      const searched = await applySearch(page, STATUS_QUERY[status]);
      if (!searched) {
        log("warn", `${list.label}: campo pesquisar não apareceu.`);
      }
      await screenshot(page, `crm-${list.label}-${status}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());

      const seen = new Set<string>();
      for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
        const batch = (await extractFromTable(page, status)).filter((lead) => {
          const key = `${status}:${onlyDigits(lead.cpf)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        found.push(...batch);
        log("info", `${list.label} / ${status}: ${batch.length} CPF(s) na página ${pageIndex + 1}.`);
        const moved = await gotoNextPage(page);
        if (!moved) break;
      }
    }
  }

  const unique = uniqueLeads(found);
  log("info", `CRM: ${unique.length} cliente(s) únicos nos dois status.`);
  return unique;
}
