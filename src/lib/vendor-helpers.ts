const CPF_FIND_RE = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/;
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

function formatCpfDigits(raw: string) {
  const digits = raw.replace(/\D/g, "").padStart(11, "0").slice(-11);
  if (digits.length !== 11) return raw.trim();
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
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
  cpf: string | null;
  status: string;
  /** Ex.: 19/09/2026 (Manhã) */
  agenda: string | null;
  /** Só a data DD/MM/YYYY para filtrar mês */
  agendaDate: string | null;
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
  queriedAt: string;
};

const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/g;
const AGENDA_RE = /Agen\.?\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*(\([^)]+\))?/i;
const OS_LABEL_RE = /\bOS\s*:\s*(\d{3,})\b/i;
/** WhatsApp costuma cortar ~4k; fatiamos com folga. */
const MAX_MESSAGE_CHARS = 3500;

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

export function formatQueryTimestamp(now = new Date()) {
  const date = now.toLocaleDateString("pt-BR");
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
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

/** Preferência: "OS: 11194391" — nunca o #id da venda. */
export function extractOs(rowText: string) {
  const labeled = rowText.match(OS_LABEL_RE);
  if (labeled?.[1]) return labeled[1];
  return null;
}

export function extractAgenda(rowText: string): { full: string; date: string } | null {
  const match = rowText.match(AGENDA_RE);
  if (!match?.[1]) return null;
  const rawPeriod = (match[2] ?? "").trim();
  const period =
    rawPeriod && !/^\(?\s*null\s*\)?$/i.test(rawPeriod) ? ` ${rawPeriod}` : "";
  return { full: `${match[1]}${period}`, date: match[1] };
}

function looksLikePhone(line: string) {
  return /^\(?\d{2}\)?\s*\d{4,5}-?\d{4}\b/.test(line);
}

function looksLikeNameLine(line: string) {
  if (!line || line.length < 3) return false;
  if (CPF_FIND_RE.test(line)) return false;
  if (/^#\d+/.test(line)) return false;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(line)) return false;
  if (/^P\./i.test(line)) return false;
  if (/cep:|end\.|bairro:|class\.|plano:|pag:|venc|contrato|bundle/i.test(line)) return false;
  if (/instalado|agendado|cancelado|quebra|biometr|processando/i.test(line)) return false;
  if (/^OS\s*:/i.test(line)) return false;
  if (/^Agen/i.test(line)) return false;
  if (/^Venda\s*:/i.test(line)) return false;
  if (looksLikePhone(line)) return false;
  if (!/[a-zA-ZÀ-ú]{3,}/.test(line)) return false;
  // Evita pegar só o login do vendedor (uma palavra curta) quando há nome completo perto do CPF
  return true;
}

export function guessVendorName(rowText: string) {
  const lines = rowText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Preferência: nome imediatamente acima do telefone/CPF (coluna Informações)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!CPF_FIND_RE.test(line) && !looksLikePhone(line)) continue;
    for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
      if (looksLikeNameLine(lines[j])) return lines[j].slice(0, 80);
    }
  }

  // Fallback: maior linha com cara de nome completo (2+ palavras)
  const candidates = lines.filter(looksLikeNameLine);
  const full = candidates.find((line) => line.split(/\s+/).length >= 2);
  return (full || candidates[0] || "Cliente").slice(0, 80);
}

export function extractCpf(rowText: string) {
  CPF_REGEX.lastIndex = 0;
  const match = CPF_REGEX.exec(rowText);
  if (!match?.[1]) return null;
  return formatCpfDigits(match[1]);
}

export function extractDates(rowText: string) {
  return [...rowText.matchAll(DATE_RE)].map((item) => item[1]);
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

export function pickDateForKind(kind: VendorQueryKind, dates: string[], agendaDate: string | null) {
  if (agendaDate) return agendaDate;
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
    const key = `${row.cpf ?? ""}|${row.os ?? ""}|${normalizeText(row.name)}|${normalizeText(row.status)}|${row.agenda ?? row.date ?? ""}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

export function filterRows(kind: VendorQueryKind, rows: VendorCrmRow[], now = new Date()) {
  return uniqueRows(rows).filter((row) => {
    if (!matchesWantedStatus(kind, row.status)) return false;
    if (kind === "quebra" || kind === "biometria") return true;
    const dateForMonth = row.agendaDate || row.date;
    if (!dateForMonth) return true;
    return dateInCurrentMonth(dateForMonth, now);
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

export function consultationFooter(queriedAt = formatQueryTimestamp()) {
  return `_Consulta realizada em ${queriedAt}_`;
}

export function menuMessage(crmUser?: string | null, queriedAt = formatQueryTimestamp()) {
  const who = crmUser ? `\nConta: *${crmUser}*` : "";
  return (
    `*Menu CRM ONE (NIO)*${who}\n\n` +
    `1️⃣ Instalados — nome + OS _(mês vigente)_\n` +
    `2️⃣ Agendados _(mês vigente)_\n` +
    `3️⃣ Tratar quebra / Quebra em tratamento\n` +
    `4️⃣ Cancelados do mês\n` +
    `5️⃣ Ag. biometria\n` +
    `6️⃣ Faturas clientes\n` +
    `7️⃣ Encerrar e deslogar\n\n` +
    consultationFooter(queriedAt)
  );
}

export function loggedInMessage(crmUser: string, queriedAt = formatQueryTimestamp()) {
  return `✅ *Logado*\nConta: *${crmUser}*\n\n${menuMessage(crmUser, queriedAt)}`;
}

export function askCpfFaturaMessage() {
  return (
    `📄 *Faturas de clientes*\n\n` +
    `Envie o *CPF* (ou CNPJ) do cliente em qualquer formato.\n` +
    `Exemplos: \`591.028.530-00\` ou \`59102853000\`\n\n` +
    `_Digite *7* para encerrar ou *1–5* para outras opções._`
  );
}

export function afterFaturaMessage() {
  return (
    `Precisa de mais alguma coisa?\n` +
    `• Envie *outro CPF* para nova fatura\n` +
    `• Digite *1–5* para outras consultas do CRM\n` +
    `• Digite *7* para encerrar`
  );
}

/** Aceita CPF (11) ou CNPJ (14) em qualquer máscara. */
export function parseDocumentInput(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;
  return null;
}

export function formatFaturaText(params: {
  maskedDoc: string;
  customerName: string | null;
  invoices: Array<{
    amount: number;
    dueDate: string;
    status: string;
    contract: string | null;
    digitableLine: string | null;
    barcode: string | null;
    pix: string | null;
  }>;
  queriedAt: string;
}): string {
  const { maskedDoc, customerName, invoices, queriedAt } = params;
  if (!invoices.length) {
    return (
      `📄 *Faturas*\nCPF/CNPJ: *${maskedDoc}*\n\n` +
      `Não encontrei faturas em aberto para este documento.\n\n` +
      `${afterFaturaMessage()}\n\n` +
      consultationFooter(queriedAt)
    );
  }

  const who = customerName ? `\nCliente: *${customerName}*` : "";
  const blocks = invoices.map((inv, index) => {
    const lines = [
      `*Fatura ${index + 1}*`,
      `Valor: ${inv.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      `Vencimento: ${inv.dueDate}`,
      `Status: ${inv.status}`,
    ];
    if (inv.contract) lines.push(`Contrato: ${inv.contract}`);
    if (inv.digitableLine) {
      lines.push("", "*Boleto — linha digitável:*", inv.digitableLine.replace(/\s+/g, ""));
    }
    if (inv.pix) {
      lines.push("", "*Pix copia e cola:*", inv.pix);
    }
    return lines.join("\n");
  });

  return (
    `📄 *Faturas*\nCPF/CNPJ: *${maskedDoc}*${who}\n` +
    `*Quantidade: ${invoices.length}*\n\n` +
    `${blocks.join("\n\n")}\n\n` +
    `📎 Em seguida envio o(s) *PDF do boleto* para baixar.\n\n` +
    `${afterFaturaMessage()}\n\n` +
    consultationFooter(queriedAt)
  );
}

/** Pedido claro: só o campo usuário primeiro. */
export function askLoginMessage() {
  return askUserOnlyMessage();
}

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

export function formatRowLine(row: VendorCrmRow, index: number, kind: VendorQueryKind) {
  const lines = [`${index}. *${row.name}*`];
  if (kind === "instalados" || kind === "agendados") {
    if (row.agenda) lines.push(`   Agen.: ${row.agenda}`);
    if (row.os) lines.push(`   OS: ${row.os}`);
    if (row.cpf) lines.push(`   CPF: ${row.cpf}`);
    return lines.join("\n");
  }
  if (kind === "quebra") {
    lines.push(`   _${row.status}_`);
  }
  if (row.agenda) lines.push(`   Agen.: ${row.agenda}`);
  else if (row.date) lines.push(`   Data: ${row.date}`);
  if (row.os) lines.push(`   OS: ${row.os}`);
  if (row.cpf) lines.push(`   CPF: ${row.cpf}`);
  return lines.join("\n");
}

/** Monta uma ou mais mensagens — envia *todos* os registros, sem “e mais N”. */
export function formatQueryResultMessages(result: VendorQueryResult): string[] {
  const queriedAt = result.queriedAt || formatQueryTimestamp();
  const footer = consultationFooter(queriedAt);
  const askMore =
    `Precisa de mais alguma informação?\n` +
    `Digite *1–6* para outra busca ou *7* para encerrar.`;

  if (result.kind === "faturas") {
    return [
      `📄 *Faturas de clientes*\n\n` +
        `${result.note ?? "Em breve."}\n\n` +
        `${askMore}\n\n` +
        footer,
    ];
  }

  const monthBit = result.monthLabel ? ` — ${result.monthLabel}` : "";
  const header = `📋 *${result.title}*${monthBit}\n*Quantidade: ${result.count}*`;

  if (!result.count) {
    return [`${header}\n\nNenhum registro encontrado.\n\n${askMore}\n\n${footer}`];
  }

  const lines = result.rows.map((row, index) => formatRowLine(row, index + 1, result.kind));
  const messages: string[] = [];
  let chunk = `${header}\n\n`;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const candidate = `${chunk}${line}\n`;
    if (candidate.length > MAX_MESSAGE_CHARS && chunk.trim() !== header) {
      messages.push(chunk.trimEnd());
      chunk = `📋 *${result.title}* _(cont.)_\n\n${line}\n`;
    } else {
      chunk = candidate;
    }
  }

  const closing = `\n${askMore}\n\n${footer}`;
  if ((chunk + closing).length > MAX_MESSAGE_CHARS + 200) {
    messages.push(chunk.trimEnd());
    messages.push(`${askMore}\n\n${footer}`);
  } else {
    messages.push(`${chunk.trimEnd()}\n${closing}`);
  }
  return messages;
}

/** Compat: uma string única (testes / preview). */
export function formatQueryResult(result: VendorQueryResult) {
  return formatQueryResultMessages(result).join("\n\n---\n\n");
}

export function optionFromText(text: string): VendorQueryKind | "encerrar" | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/1️⃣/g, "1")
    .replace(/2️⃣/g, "2")
    .replace(/3️⃣/g, "3")
    .replace(/4️⃣/g, "4")
    .replace(/5️⃣/g, "5")
    .replace(/6️⃣/g, "6")
    .replace(/7️⃣/g, "7");
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

export function buildRowFromText(block: string, kind: VendorQueryKind): VendorCrmRow | null {
  const status = detectStatus(block);
  if (!status) return null;
  const agenda = extractAgenda(block);
  const dates = extractDates(block);
  return {
    name: guessVendorName(block),
    os: extractOs(block),
    cpf: extractCpf(block),
    status,
    agenda: agenda?.full ?? null,
    agendaDate: agenda?.date ?? null,
    date: pickDateForKind(kind, dates, agenda?.date ?? null),
    raw: block.trim().slice(0, 500),
  };
}
