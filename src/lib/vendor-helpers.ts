const CPF_REGEX = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type VendorQueryKind =
  | "instalados"
  | "agendados"
  | "quebra"
  | "cancelados"
  | "biometria"
  | "faturas";

export type VendorCrmRow = {
  name: string;
  os: string | null;
  status: string;
  date: string | null;
  raw: string;
};

export type VendorQueryResult = {
  kind: VendorQueryKind;
  title: string;
  count: number;
  rows: VendorCrmRow[];
  monthLabel: string | null;
  note?: string;
};

const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/g;
const OS_RE = /#\s*(\d{3,})|\bOS[:\s#-]*(\d{3,})\b/i;
const MAX_ROWS_IN_REPLY = 40;

export function currentMonthParts(now = new Date()) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return {
    month,
    year,
    label: now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    mm: String(month).padStart(2, "0"),
    yyyy: String(year),
  };
}

export function parseBrDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) return null;
  return { day, month, year };
}

export function dateInCurrentMonth(value: string | null | undefined, now = new Date()) {
  const parsed = parseBrDate(value);
  if (!parsed) return false;
  const { month, year } = currentMonthParts(now);
  return parsed.month === month && parsed.year === year;
}

export function extractOs(rowText: string) {
  const match = rowText.match(OS_RE);
  if (!match) return null;
  return match[1] || match[2] || null;
}

export function extractDates(rowText: string) {
  return [...rowText.matchAll(DATE_RE)].map((item) => item[1]);
}

export function guessVendorName(rowText: string) {
  const lines = rowText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !CPF_REGEX.test(line))
    .filter((line) => !/^#\d+/.test(line))
    .filter((line) => !/^\d{2}\/\d{2}\/\d{4}/.test(line))
    .filter((line) => !/^P\./i.test(line))
    .filter((line) => !/cep:|end\.|bairro:|class\.|plano:|pag:|venc/i.test(line))
    .filter((line) => !/instalado|agendado|cancelado|quebra|biometr/i.test(line))
    .filter((line) => /[a-zA-ZÀ-ú]{3,}/.test(line));
  return lines[0]?.slice(0, 80) || "Cliente";
}

export function detectStatus(rowText: string): string | null {
  const n = normalizeText(rowText);
  if (n.includes("quebra em tratamento")) return "quebra em tratamento";
  if (n.includes("tratar quebra")) return "tratar quebra";
  if (/\bag\.?\s*biometr/.test(n) || n.includes("agendamento biometria") || n.includes("ag biometria")) {
    return "ag. biometria";
  }
  if (n.includes("aguardando biometria")) return "aguardando biometria";
  if (n.includes("instalado")) return "instalado";
  if (n.includes("agendado")) return "agendado";
  if (n.includes("cancelado")) return "cancelado";
  return null;
}

export function pickDateForKind(kind: VendorQueryKind, dates: string[]) {
  if (!dates.length) return null;
  if (kind === "cancelados") return dates[dates.length - 1] ?? null;
  return dates[0] ?? null;
}

export function matchesWantedStatus(kind: VendorQueryKind, status: string) {
  const n = normalizeText(status);
  if (kind === "instalados") return n === "instalado";
  if (kind === "agendados") return n === "agendado";
  if (kind === "quebra") return n === "tratar quebra" || n === "quebra em tratamento";
  if (kind === "cancelados") return n.includes("cancelado");
  if (kind === "biometria") {
    return n === "ag. biometria" || n.includes("ag biometria") || n.includes("agendamento biometria");
  }
  return false;
}

export function uniqueRows(rows: VendorCrmRow[]) {
  const map = new Map<string, VendorCrmRow>();
  for (const row of rows) {
    const key = `${normalizeText(row.name)}|${row.os ?? ""}|${normalizeText(row.status)}|${row.date ?? ""}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

export function filterRows(kind: VendorQueryKind, rows: VendorCrmRow[], now = new Date()) {
  return uniqueRows(rows).filter((row) => {
    if (!matchesWantedStatus(kind, row.status)) return false;
    if (kind === "quebra" || kind === "biometria") return true;
    if (!row.date) return true;
    return dateInCurrentMonth(row.date, now);
  });
}

export function parseCredentials(text: string): { user: string; pass: string } | null {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return null;

  const labeled = cleaned.match(
    /(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*(\S+)\s+(?:senha|password|pass)\s*[:=]\s*(\S+)/i,
  );
  if (labeled) {
    return { user: labeled[1], pass: labeled[2] };
  }

  const lines = cleaned.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const user = lines[0].replace(/^(?:usuario|usu[aá]rio|login|user)\s*[:=]\s*/i, "").trim();
    const pass = lines[1].replace(/^(?:senha|password|pass)\s*[:=]\s*/i, "").trim();
    if (user && pass) return { user, pass };
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { user: parts[0], pass: parts[1] };
  }
  return null;
}

export function menuMessage(crmUser?: string | null) {
  const who = crmUser ? `\nConta: *${crmUser}*` : "";
  return (
    `*Menu CRM Unik (NIO)*${who}\n\n` +
    `*(1)* Instalados — nome + OS _(mês vigente)_\n` +
    `*(2)* Agendados _(mês vigente)_\n` +
    `*(3)* Tratar quebra / Quebra em tratamento\n` +
    `*(4)* Cancelados do mês\n` +
    `*(5)* Ag. biometria\n` +
    `*(6)* Faturas clientes _(em breve)_\n` +
    `*(7)* Encerrar e deslogar\n\n` +
    `_Consultas só na aba NIO (sem Tim Fibra)._`
  );
}

export function loggedInMessage(crmUser: string) {
  return `✅ *Logado*\nConta: *${crmUser}*\n\n${menuMessage(crmUser)}`;
}

export function askLoginMessage() {
  return askUserOnlyMessage();
}

/** Pedido claro: só o campo usuário primeiro. */
export function askUserOnlyMessage() {
  return (
    `🔐 *Acesso ao CRM Unik*\n\n` +
    `Preencha em duas etapas:\n\n` +
    `*1/2 — Usuário*\n` +
    `Envie agora só o *usuário* do CRM (exemplo: \`Elisangela\`).\n\n` +
    `Depois eu peço a *senha*.\n\n` +
    `_Se preferir, pode mandar nas duas linhas:_\n` +
    `\`usuario\`\n` +
    `\`senha\``
  );
}

export function askPasswordMessage(user: string) {
  return (
    `🔐 *Acesso ao CRM Unik*\n\n` +
    `*2/2 — Senha*\n` +
    `Usuário: *${user}*\n\n` +
    `Agora envie só a *senha* do CRM.`
  );
}

export function loginErrorMessage() {
  return (
    `❌ Não consegui entrar no CRM com esses dados.\n\n` +
    `Pode tentar de novo?\n` +
    `Envie o *usuário* do CRM.`
  );
}

function formatRowLine(row: VendorCrmRow, index: number, kind: VendorQueryKind) {
  const os = row.os ? ` — OS #${row.os}` : "";
  const date = row.date ? ` · ${row.date}` : "";
  if (kind === "quebra") {
    return `${index}. *${row.name}*${os}\n   _${row.status}_${date}`;
  }
  return `${index}. *${row.name}*${os}${date}`;
}

export function formatQueryResult(result: VendorQueryResult) {
  if (result.kind === "faturas") {
    return (
      `📄 *Faturas de clientes*\n\n` +
      `${result.note ?? "Em breve."}\n\n` +
      `Precisa de mais alguma informação?\n` +
      `Digite *1–6* para outra busca ou *7* para encerrar.`
    );
  }

  const monthBit = result.monthLabel ? ` — ${result.monthLabel}` : "";
  const header = `📋 *${result.title}*${monthBit}\n*Quantidade: ${result.count}*`;
  if (!result.count) {
    return (
      `${header}\n\n` +
      `Nenhum registro encontrado.\n\n` +
      `Precisa de mais alguma informação?\n` +
      `Digite *1–6* para outra busca ou *7* para encerrar.`
    );
  }

  const shown = result.rows.slice(0, MAX_ROWS_IN_REPLY);
  const lines = shown.map((row, index) => formatRowLine(row, index + 1, result.kind));
  const extra =
    result.count > shown.length
      ? `\n… e mais *${result.count - shown.length}* registro(s).`
      : "";

  return (
    `${header}\n\n` +
    `${lines.join("\n")}${extra}\n\n` +
    `Precisa de mais alguma informação?\n` +
    `Digite *1–6* para outra busca ou *7* para encerrar.`
  );
}

export function optionFromText(text: string): VendorQueryKind | "encerrar" | null {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return null;
  if (/^7\b/.test(cleaned) || /^(encerrar|sair|logout|deslogar)\b/.test(cleaned)) return "encerrar";
  if (/^1\b/.test(cleaned) || /^instalad/.test(cleaned)) return "instalados";
  if (/^2\b/.test(cleaned) || /^agendad/.test(cleaned)) return "agendados";
  if (/^3\b/.test(cleaned) || /quebra/.test(cleaned)) return "quebra";
  if (/^4\b/.test(cleaned) || /^cancelad/.test(cleaned)) return "cancelados";
  if (/^5\b/.test(cleaned) || /biometr/.test(cleaned)) return "biometria";
  if (/^6\b/.test(cleaned) || /fatura/.test(cleaned)) return "faturas";
  return null;
}
