import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log, setStep } from "@/lib/store";
import {
  extractGedAnalysis,
  formatCpf,
  looksLikeEmptyGed,
  onlyDigits,
} from "@/lib/text";

const GED_LOGIN = "https://ged360.niointernet.com.br/brprontopdv/autenticacao/index";
const GED_HOST = "https://ged360.niointernet.com.br/brprontopdv/";

export type GedLookup = {
  cpf: string;
  hasDigitization: boolean;
  result: string | null;
};

async function acceptCookies(page: Page) {
  await page
    .context()
    .addCookies([
      {
        name: "cookieAceitaBrProntoPDV",
        value: "true",
        url: "https://ged360.niointernet.com.br/",
      },
    ]);
  await clickFirst(page, ["#btnAceitar", 'button:has-text("Aceitar")'], { timeout: 4000 });
  await page.waitForTimeout(400);
}

export async function loginGed(
  page: Page,
  user: string,
  pass: string,
  domain: "1" | "2",
) {
  setStep("Entrando no GED360 e aceitando cookies...");
  await page.goto(GED_LOGIN, { waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  await fillFirst(page, ["#prkUsuario", 'input[name="prkUsuario"]'], user);
  await fillFirst(page, ["#desSenha", 'input[name="desSenha"]'], pass);

  if (domain === "2") {
    await clickFirst(page, [".box-slc .lnk"]);
    await clickFirst(page, ['span[data-dominio="2"]']);
  }

  await screenshot(page, "ged-login");
  await clickFirst(page, [".bt-acessar", 'input[value="Acessar"]']);
  await page.waitForTimeout(2500);
  await screenshot(page, "ged-pos-login");

  const url = page.url();
  const body = await visibleText(page);
  if (/usu[aá]rio ou senha inv[aá]lido|senha inv[aá]lid/i.test(body)) {
    throw new Error("GED360 recusou o login. Confira usuário, senha e domínio.");
  }
  if (url.includes("/autenticacao/") && /erro|inv[aá]lido/i.test(body)) {
    throw new Error("GED360 não autenticou. Confira as credenciais.");
  }
  log("info", `GED360 autenticado em ${url}`);
}

async function searchCpf(page: Page, cpf: string) {
  const digits = onlyDigits(cpf);
  const url =
    `${GED_HOST}digitalizacao-ged/visualizar` +
    `?pagina=0&file_export=&request=1&total=&num_cpf=${digits}` +
    `&num_cnpj=&num_acesso=&num_id_unico=&num_protocolo=&num_gtv=&num_nrc=&num_pass=` +
    `&dat_envio_inicial=&dat_envio_final=&dat_conferencia_inicial=&dat_conferencia_final=` +
    `&dat_conferencia_ini_rel=&dat_conferencia_fin_rel=&origem_digitalizacao=` +
    `&undefined_label=&btnFiltrar=Filtrar&vizualizacao=2&tab_digitalizacao=`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await Promise.race([
      page.getByText(/resultado da an[aá]lise/i).first().waitFor({ timeout: 7000 }),
      page.getByText(/nenhum registro|n[aã]o (foi )?encontr|sem resultado/i).first().waitFor({ timeout: 7000 }),
    ]).catch(() => undefined);
    await page.waitForTimeout(500);

    const urlCpf = onlyDigits(new URL(page.url()).searchParams.get("num_cpf") ?? "");
    const typed = onlyDigits(
      await page.locator('input[name="num_cpf"], #num_cpf').first().inputValue().catch(() => ""),
    );
    const onPage = urlCpf || typed;
    if (!onPage || onPage === digits) return;
    log("warn", `GED ainda não trocou o CPF da busca (${formatCpf(onPage)}). Tentando de novo...`);
  }
}

async function readGedStatusFromDom(page: Page): Promise<string | null> {
  try {
    const value = await page.evaluate(() => {
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const labelRe = /resultado da an[aá]lise|status da an[aá]lise|status da digitaliza/i;
      const emptyRe =
        /nenhum registro|n[aã]o (foi )?encontr|sem resultado|nenhuma digitaliza|registro n[aã]o localizado/i;

      const fromNext = (el: Element): string | null => {
        const next = el.nextElementSibling;
        if (next) {
          const v = normalize(next.textContent || "");
          if (v && !labelRe.test(v) && v.length >= 2 && v.length <= 80 && !emptyRe.test(v)) {
            return v;
          }
        }
        const parent = el.parentElement;
        if (parent) {
          const kids = Array.from(parent.children);
          const idx = kids.indexOf(el);
          if (idx >= 0 && kids[idx + 1]) {
            const v = normalize(kids[idx + 1].textContent || "");
            if (v && !labelRe.test(v) && v.length >= 2 && v.length <= 80 && !emptyRe.test(v)) {
              return v;
            }
          }
        }
        const row = el.closest("tr");
        if (row) {
          const cells = Array.from(row.querySelectorAll("th, td"));
          const i = cells.indexOf(el as HTMLTableCellElement);
          if (i >= 0 && cells[i + 1]) {
            const v = normalize(cells[i + 1].textContent || "");
            if (v && v.length >= 2 && v.length <= 80 && !emptyRe.test(v)) return v;
          }
        }
        const own = normalize(el.textContent || "");
        const inline = own.match(
          /(?:resultado da an[aá]lise|status da an[aá]lise|status da digitaliza(?:ção|cao)?)\s*[:\-–—]?\s*(.+)/i,
        );
        if (inline?.[1]) {
          const v = normalize(inline[1]);
          if (v && v.length >= 2 && v.length <= 80 && !emptyRe.test(v) && !labelRe.test(v)) {
            return v;
          }
        }
        return null;
      };

      const candidates = Array.from(
        document.querySelectorAll("td, th, dt, dd, label, span, strong, b, p, div, li"),
      );
      for (const el of candidates) {
        const t = normalize(el.textContent || "");
        if (!labelRe.test(t) || t.length > 160) continue;
        const found = fromNext(el);
        if (found) return found;
      }
      return null;
    });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export async function lookupGedCpf(page: Page, cpf: string): Promise<GedLookup> {
  const wanted = onlyDigits(cpf);
  setStep(`Consultando CPF ${formatCpf(cpf)} no GED360...`);
  await searchCpf(page, cpf);
  await screenshot(page, `ged-${wanted}`);
  const text = await visibleText(page);
  const urlCpf = onlyDigits(new URL(page.url()).searchParams.get("num_cpf") ?? "");
  const stale = Boolean(urlCpf) && urlCpf !== wanted;
  if (stale) {
    log("warn", `GED ${formatCpf(cpf)}: a tela ainda era de outro CPF. Sem resultado desta busca.`);
    return { cpf: formatCpf(cpf), hasDigitization: false, result: null };
  }

  const empty = looksLikeEmptyGed(text);
  const fromDom = empty ? null : await readGedStatusFromDom(page);
  const fromText = empty ? null : extractGedAnalysis(text);
  const result = fromDom || fromText;
  const hasDigitization = Boolean(result);
  if (!result) {
    log("info", `GED ${formatCpf(cpf)}: sem Resultado da Análise — permanece o status do CRM.`);
  } else {
    log("info", `GED ${formatCpf(cpf)}: Resultado da Análise = ${result}`);
  }
  return { cpf: formatCpf(cpf), hasDigitization, result };
}
