import type { Page } from "playwright";
import { clickFirst, fillFirst, screenshot, visibleText } from "@/lib/browser";
import { log, setStep } from "@/lib/store";
import {
  cleanGedAnalysisValue,
  extractGedAnalysis,
  formatCpf,
  isJunkGedAnalysis,
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

/**
 * A linha Resultado da Análise sobe/desce conforme os campos acima.
 * Acha o rótulo pelo texto e lê o valor à direita na mesma linha — nunca o rodapé Regional.
 */
async function readGedStatusFromDom(page: Page): Promise<string | null> {
  try {
    const value = await page.evaluate(() => {
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const labelOnly =
        /^(resultado da an[aá]lise|status da an[aá]lise)\s*:?\s*$/i;
      const labelInText = /resultado da an[aá]lise/i;
      const emptyRe =
        /nenhum registro|n[aã]o (foi )?encontr|sem resultado|nenhuma digitaliza|registro n[aã]o localizado/i;
      const stopRe =
        /status da digitaliza|local de digitaliza|^linha\(?s?\)?|\bregional\b/i;
      const junkRe =
        /^(regional|rsul|rnul|pdv|linha|linhas?|status|analise|conferido|-)$/i;

      const accept = (raw: string): string | null => {
        let value = normalize(raw);
        const cut = value.search(stopRe);
        if (cut >= 0) value = value.slice(0, cut).trim();
        value = value.replace(/^[:.\-–—|/\\]+/, "").replace(/[:.\-–—|/\\]+$/, "").trim();
        if (value.length < 2 || value.length > 80) return null;
        if (emptyRe.test(value) || junkRe.test(value) || labelInText.test(value)) return null;
        if (/^regional\b/i.test(value) || /\bregional\b/i.test(value)) return null;
        if (/^status da /i.test(value) || /^local de /i.test(value)) return null;
        return value;
      };

      const all = Array.from(
        document.querySelectorAll("td, th, dt, dd, label, span, strong, b, p, div, li, font, em"),
      );

      const labelEls = all
        .filter((el) => labelOnly.test(normalize(el.textContent || "")))
        .sort((a, b) => {
          const la = (a.textContent || "").length;
          const lb = (b.textContent || "").length;
          if (la !== lb) return la - lb;
          const aa = a.getBoundingClientRect();
          const bb = b.getBoundingClientRect();
          return aa.width * aa.height - bb.width * bb.height;
        });

      const fromPoint = (el: Element): string | null => {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) return null;
        const ys = [rect.top + rect.height / 2, rect.top + 8, rect.bottom - 8];
        const xs = [24, 48, 90, 140, 200, 280, 360];
        for (const y of ys) {
          for (const dx of xs) {
            const hits = document.elementsFromPoint(rect.right + dx, y);
            for (const hit of hits) {
              if (hit === el || el.contains(hit)) continue;
              const v = accept(hit.textContent || "");
              if (v) return v;
            }
          }
        }
        return null;
      };

      const fromSameRow = (el: Element): string | null => {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) return null;
        let best: string | null = null;
        let bestDx = Infinity;
        for (const other of all) {
          if (other === el || el.contains(other) || other.contains(el)) continue;
          const text = normalize(other.textContent || "");
          if (!text || text.length > 80 || labelInText.test(text)) continue;
          const r = other.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const labelMid = (rect.top + rect.bottom) / 2;
          const otherMid = (r.top + r.bottom) / 2;
          if (Math.abs(otherMid - labelMid) > Math.max(16, rect.height * 0.75)) continue;
          if (r.left < rect.right - 8) continue;
          const dx = r.left - rect.right;
          if (dx >= bestDx) continue;
          const ok = accept(text);
          if (ok) {
            bestDx = dx;
            best = ok;
          }
        }
        return best;
      };

      const fromStructure = (el: Element): string | null => {
        const next = el.nextElementSibling;
        if (next) {
          const v = accept(next.textContent || "");
          if (v) return v;
        }
        const parent = el.parentElement;
        if (parent) {
          const kids = Array.from(parent.children);
          const idx = kids.indexOf(el);
          if (idx >= 0 && kids[idx + 1]) {
            const v = accept(kids[idx + 1].textContent || "");
            if (v) return v;
          }
          const own = accept(
            (parent.textContent || "").replace(/resultado da an[aá]lise\s*:?\s*/i, ""),
          );
          if (own && normalize(parent.textContent || "").length <= 120) return own;
        }
        const row = el.closest("tr");
        if (row) {
          const cells = Array.from(row.querySelectorAll("th, td"));
          const i = cells.findIndex((cell) => cell === el || cell.contains(el));
          if (i >= 0 && cells[i + 1]) {
            const v = accept(cells[i + 1].textContent || "");
            if (v) return v;
          }
        }
        const dl = el.closest("dl");
        if (dl && el.tagName === "DT") {
          const dd = el.nextElementSibling;
          if (dd?.tagName === "DD") {
            const v = accept(dd.textContent || "");
            if (v) return v;
          }
        }
        return null;
      };

      for (const el of labelEls) {
        const found = fromPoint(el) || fromSameRow(el) || fromStructure(el);
        if (found) return found;
      }

      for (const el of all) {
        const t = normalize(el.textContent || "");
        if (!labelInText.test(t) || t.length > 160) continue;
        const inline = t.match(
          /resultado da an[aá]lise\s*[:\-–—]?\s*(.+)$/i,
        );
        if (inline?.[1]) {
          const v = accept(inline[1]);
          if (v) return v;
        }
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
  const fromText = empty ? null : extractGedAnalysis(text);
  const fromDom = empty ? null : cleanGedAnalysisValue((await readGedStatusFromDom(page)) ?? "");
  const result =
    [fromText, fromDom].find((value) => Boolean(value) && !isJunkGedAnalysis(value ?? "")) ?? null;
  const hasDigitization = Boolean(result);
  if (!result) {
    log("info", `GED ${formatCpf(cpf)}: sem Resultado da Análise — permanece o status do CRM.`);
  } else {
    log("info", `GED ${formatCpf(cpf)}: Resultado da Análise = ${result}`);
  }
  return { cpf: formatCpf(cpf), hasDigitization, result };
}
