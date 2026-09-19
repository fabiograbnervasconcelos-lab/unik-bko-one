import { log } from "@/lib/store";

const ROBO_BASE =
  process.env.FATURA_ROBO_URL?.replace(/\/$/, "") ||
  "https://robo-one-telecom-production.up.railway.app";

export type FaturaInvoice = {
  id: string;
  amount: number;
  dueDate: string;
  status: string;
  barcode: string | null;
  digitableLine: string | null;
  pix: string | null;
  origin: string | null;
  contract: string | null;
  customerId: string | null;
  pdfId: string | null;
  pdfUrl: string | null;
  pdfFileName: string | null;
  customerName?: string | null;
};

export type FaturaLookup = {
  ok: boolean;
  document: { kind: string; digits: string; formatted: string } | null;
  maskedDocument: string | null;
  source: string | null;
  invoices: FaturaInvoice[];
  message: string | null;
  customerName: string | null;
  replyText: string | null;
};

function absoluteUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${ROBO_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function consultarFaturaPorDoc(docDigits: string): Promise<FaturaLookup> {
  const url = `${ROBO_BASE}/api/consulta?doc=${encodeURIComponent(docDigits)}`;
  log("info", `Fatura Robô One: consultando ${docDigits.slice(0, 3)}***`);
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    reply?: { text?: string };
    lookup?: {
      ok?: boolean;
      document?: { kind: string; digits: string; formatted: string };
      maskedDocument?: string;
      source?: string | null;
      invoices?: Array<Record<string, unknown>>;
      message?: string;
      customerName?: string;
    };
    message?: string;
    error?: string;
  } | null;

  if (!response.ok || !data) {
    throw new Error(data?.error || data?.message || `Falha HTTP ${response.status} na consulta de fatura.`);
  }

  const lookup = data.lookup;
  const invoices = (lookup?.invoices ?? []).map((raw) => ({
    id: String(raw.id ?? ""),
    amount: Number(raw.amount ?? 0),
    dueDate: String(raw.dueDate ?? ""),
    status: String(raw.status ?? ""),
    barcode: raw.barcode ? String(raw.barcode) : null,
    digitableLine: raw.digitableLine ? String(raw.digitableLine) : null,
    pix: raw.pix ? String(raw.pix) : null,
    origin: raw.origin ? String(raw.origin) : null,
    contract: raw.contract ? String(raw.contract) : null,
    customerId: raw.customerId ? String(raw.customerId) : null,
    pdfId: raw.pdfId ? String(raw.pdfId) : null,
    pdfUrl: raw.pdfUrl ? absoluteUrl(String(raw.pdfUrl)) : null,
    pdfFileName: raw.pdfFileName ? String(raw.pdfFileName) : null,
  }));

  return {
    ok: Boolean(data.ok && lookup?.ok !== false),
    document: lookup?.document ?? null,
    maskedDocument: lookup?.maskedDocument ?? null,
    source: lookup?.source ?? null,
    invoices,
    message: lookup?.message ?? data.message ?? null,
    customerName: lookup?.customerName ?? null,
    replyText: data.reply?.text ?? null,
  };
}

export async function baixarBoletoPdf(invoice: FaturaInvoice): Promise<{ buffer: Buffer; fileName: string } | null> {
  const url =
    invoice.pdfUrl ||
    (invoice.customerId
      ? `${ROBO_BASE}/api/boleto?doc=${encodeURIComponent(invoice.customerId)}`
      : null);
  if (!url) return null;
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    log("warn", `Fatura: PDF não baixou (${response.status}) ${url}`);
    return null;
  }
  const contentType = response.headers.get("content-type") || "";
  if (!/pdf|octet-stream/i.test(contentType) && !url.includes("/api/pdf/")) {
    // ainda tenta se content-disposition diz pdf
    const disposition = response.headers.get("content-disposition") || "";
    if (!/pdf/i.test(disposition)) {
      log("warn", `Fatura: resposta não parece PDF (${contentType})`);
    }
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100) return null;
  const fileName =
    invoice.pdfFileName ||
    `boleto-${invoice.dueDate.replace(/\//g, "") || invoice.id || "nio"}.pdf`;
  return { buffer, fileName };
}

export function formatMoneyBr(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
