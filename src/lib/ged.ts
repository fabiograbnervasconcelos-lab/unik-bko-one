import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log, setStep } from "@/lib/store";
import {
  extractGedAnalysis,
  formatCpf,
  hasDigitizationScreen,
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

async function openDigitalizacoes(page: Page) {
  setStep("Abrindo Consultar → Digitalizações...");
  await clickFirst(page, [
    "text=Consultar",
    ".item:has-text('Consultar')",
    "div.item:has-text('Consultar')",
  ]);
  await page.waitForTimeout(700);
  await clickFirst(page, [
    "text=Digitalizações",
    "text=Digitalizacao",
    "text=Digitalização",
    ".item:has-text('Digitaliza')",
  ]);
  await page.waitForTimeout(1000);
  await clickFirst(page, [
    "text=Busca unitária",
    "text=Busca unitaria",
    "text=Unitária",
    "text=Unitaria",
    "a:has-text('unitária')",
    "a:has-text('unitaria')",
  ]);
  await page.waitForTimeout(800);
}

async function searchCpf(page: Page, cpf: string) {
  const digits = onlyDigits(cpf);
  const formatted = formatCpf(digits);
  const filled = await fillFirst(
    page,
    [
      'input[name="num_cpf"]',
      "#num_cpf",
      'input[placeholder*="CPF" i]',
      'input[id*="cpf" i]',
      'input[name*="cpf" i]',
    ],
    formatted,
  );

  if (filled) {
    await clickFirst(page, [
      'input[name="btnFiltrar"]',
      'input[value="Filtrar"]',
      'button:has-text("Filtrar")',
      'button:has-text("Buscar")',
      'input[value="Buscar"]',
      'input[value="Consultar"]',
    ]);
    await page.waitForTimeout(2000);
    return;
  }

  const url =
    `${GED_HOST}digitalizacao-ged/visualizar` +
    `?pagina=0&file_export=&request=1&total=&num_cpf=${digits}` +
    `&num_cnpj=&num_acesso=&num_id_unico=&num_protocolo=&num_gtv=&num_nrc=&num_pass=` +
    `&dat_envio_inicial=&dat_envio_final=&dat_conferencia_inicial=&dat_conferencia_final=` +
    `&dat_conferencia_ini_rel=&dat_conferencia_fin_rel=&origem_digitalizacao=` +
    `&undefined_label=&btnFiltrar=Filtrar&vizualizacao=2&tab_digitalizacao=`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
}

export async function lookupGedCpf(page: Page, cpf: string, first: boolean): Promise<GedLookup> {
  if (first) {
    await openDigitalizacoes(page);
  }
  setStep(`Consultando CPF ${formatCpf(cpf)} no GED360...`);
  await searchCpf(page, cpf);
  await screenshot(page, `ged-${onlyDigits(cpf)}`);
  const text = await visibleText(page);
  const hasDigitization = hasDigitizationScreen(text);
  const result = hasDigitization ? extractGedAnalysis(text) : null;
  if (!hasDigitization) {
    log("info", `GED ${formatCpf(cpf)}: sem tela de digitalização.`);
  } else if (result) {
    log("info", `GED ${formatCpf(cpf)}: Resultado da Análise = ${result}`);
  } else {
    log("warn", `GED ${formatCpf(cpf)}: digitalização abriu, mas o resultado não bateu com os status pedais.`);
  }
  return { cpf: formatCpf(cpf), hasDigitization, result };
}
