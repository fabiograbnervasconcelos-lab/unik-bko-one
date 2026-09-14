import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log, setStep } from "@/lib/store";
import {
  CPF_REGEX,
  formatCpf,
  isValidCpf,
  matchCrmStatus,
  onlyDigits,
  type CrmStatus,
} from "@/lib/text";

const CRM_LOGIN = "https://uniktelecom.com.br/proadmin/login.php";

export type CrmLead = {
  name: string;
  cpf: string;
  crmStatus: CrmStatus;
};

function uniqueLeads(leads: CrmLead[]) {
  const map = new Map<string, CrmLead>();
  for (const lead of leads) {
    const key = onlyDigits(lead.cpf);
    if (!map.has(key)) map.set(key, lead);
  }
  return [...map.values()];
}

function extractLeadsFromText(text: string, status: CrmStatus): CrmLead[] {
  const leads: CrmLead[] = [];
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const matches = lines[i].match(CPF_REGEX) ?? [];
    for (const raw of matches) {
      if (!isValidCpf(raw)) continue;
      const nearby = [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean).join(" ");
      const nameGuess = nearby
        .replace(CPF_REGEX, " ")
        .replace(/\d{8,}/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      leads.push({
        name: nameGuess || "Cliente CRM",
        cpf: formatCpf(raw),
        crmStatus: status,
      });
    }
  }
  return uniqueLeads(leads);
}

async function clickStatusTarget(page: Page, status: CrmStatus) {
  const needles =
    status === "aguardando biometria"
      ? [/aguardando\s+biometr/i]
      : [/cancelado\s*\/?\s*bio/i, /bio\s*expirada/i, /biometria\s+expirada/i];

  for (const frame of page.frames()) {
    const selects = frame.locator("select");
    const selectCount = await selects.count();
    for (let i = 0; i < selectCount; i += 1) {
      const select = selects.nth(i);
      const options = await select.locator("option").allTextContents();
      const match = options.find((option) => matchCrmStatus(option) === status);
      if (match) {
        await select.selectOption({ label: match }).catch(async () => {
          await select.selectOption({ label: match.trim() });
        });
        log("info", `CRM: filtro de status "${match}" aplicado.`);
        await page.waitForTimeout(1800);
        return true;
      }
    }

    for (const needle of needles) {
      const candidate = frame.getByText(needle).first();
      if (await candidate.count()) {
        await candidate.click({ timeout: 4000 }).catch(() => undefined);
        log("info", `CRM: cliquei em "${status}".`);
        await page.waitForTimeout(1800);
        return true;
      }
    }
  }
  return false;
}

async function gotoNextPage(page: Page) {
  for (const frame of page.frames()) {
    const next = frame
      .locator("a, button")
      .filter({ hasText: /pr[oó]ximo|avançar|next|>/i })
      .first();
    if (await next.count()) {
      const disabled = await next.getAttribute("disabled");
      const className = (await next.getAttribute("class")) ?? "";
      if (disabled || /disabled|inactive/i.test(className)) continue;
      const before = frame.url();
      await next.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      if (frame.url() !== before) return true;
    }
  }
  return false;
}

export async function loginCrm(page: Page, user: string, pass: string) {
  setStep("Entrando no CRM Unik...");
  await page.goto(CRM_LOGIN, { waitUntil: "domcontentloaded" });
  await fillFirst(page, ['input[name="usuario"]', 'input[placeholder="Usuario"]'], user);
  await fillFirst(page, ['input[name="senha"]', 'input[type="password"]'], pass);
  await screenshot(page, "crm-login");
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => undefined),
    clickFirst(page, ['button[type="submit"]', 'button:has-text("Entrar")']),
  ]);
  await page.waitForTimeout(1500);
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
  setStep("Lendo status cancelado/bio expirada e aguardando biometria...");
  await screenshot(page, "crm-home");
  const found: CrmLead[] = [];

  for (const status of ["cancelado/bio expirada", "aguardando biometria"] as CrmStatus[]) {
    setStep(`Filtrando CRM: ${status}`);
    const clicked = await clickStatusTarget(page, status);
    if (!clicked) {
      log("warn", `Não achei um filtro explícito para "${status}". Vou varrer a tela atual.`);
    }

    const seen = new Set<string>();
    for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
      const text = await visibleText(page);
      const batch = extractLeadsFromText(text, status).filter((lead) => {
        const key = `${status}:${onlyDigits(lead.cpf)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      found.push(...batch);
      log("info", `CRM ${status}: ${batch.length} CPF(s) na página ${pageIndex + 1}.`);
      const moved = await gotoNextPage(page);
      if (!moved) break;
    }
    await screenshot(page, `crm-${status.replace(/[^a-z0-9]+/gi, "-")}`);
  }

  const unique = uniqueLeads(found);
  log("info", `CRM: ${unique.length} cliente(s) únicos nos dois status.`);
  return unique;
}
