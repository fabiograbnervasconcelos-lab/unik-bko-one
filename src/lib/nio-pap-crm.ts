const PAP_BASE =
  process.env.NIO_PAP_CRM_URL?.replace(/\/$/, "") ||
  "https://nio-pap-crm-production.up.railway.app";

export type NioPapSeller = {
  id: string;
  name: string;
};

export type NioPapEscolhida = {
  data?: string | null;
  numeroPedido?: string | null;
  documento?: string | null;
  nome?: string | null;
  statusPap?: string | null;
  pagamento?: string | null;
  valor?: string | null;
  plano?: string | null;
  crmCodigo?: string | number | null;
  crmUrl?: string | null;
  skipped?: string | null;
  error?: string | null;
};

export type NioPapSyncResult = {
  documento?: string | null;
  dias?: number | null;
  encontrados?: number | null;
  escolhida?: NioPapEscolhida | null;
  anteriores?: NioPapEscolhida[];
  resultados?: NioPapEscolhida[];
  resumoWhatsapp?: string | null;
  whatsappEnvios?: Array<{ destino?: string; detalhe?: string; ok?: boolean }>;
  perguntas?: unknown[];
  error?: string | null;
};

/** Resposta imediata do POST /api/sync (fila assíncrona). */
export type NioPapSyncJob = {
  id?: string;
  documento?: string | null;
  nome?: string | null;
  status?: string | null;
  error?: string | null;
  report?: NioPapSyncResult | null;
  createdAt?: number | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  queue?: NioPapSyncJob[];
};

function normalizeSellerKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export function papCredentialsFromEnv() {
  const matricula = (process.env.NIO_PAP_MATRICULA || process.env.PAP_MATRICULA || "").trim();
  const senha = (process.env.NIO_PAP_SENHA || process.env.PAP_SENHA || "").trim();
  if (!matricula || !senha) return null;
  return { matricula, senha };
}

/**
 * Login do CRM usado pelo nio-pap-crm para "Carregar vendedores" / lançar
 * (ex.: fabio) — não é o nome do vendedor da venda.
 */
export function papCrmOperatorFromEnv() {
  const usuario = (
    process.env.NIO_PAP_CRM_USUARIO ||
    process.env.CRM_USUARIO ||
    ""
  ).trim();
  const senha = (process.env.NIO_PAP_CRM_SENHA || process.env.CRM_SENHA || "").trim();
  if (!usuario || !senha) return null;
  return { usuario, senha };
}

export function papDiasDefault() {
  const raw = Number(process.env.NIO_PAP_DIAS || "30");
  if (!Number.isFinite(raw)) return 30;
  return Math.min(30, Math.max(1, Math.trunc(raw)));
}

/** Casa o login do CRM com o nome do vendedor na lista PAP. */
export function matchSellerByCrmUser(
  sellers: NioPapSeller[],
  crmUser: string,
): NioPapSeller | null {
  const want = normalizeSellerKey(crmUser);
  if (!want) return null;
  const exact = sellers.find((seller) => normalizeSellerKey(seller.name) === want);
  if (exact) return exact;
  // fallback: login contido no nome ou vice-versa (ex.: ELISANGELA vs Elisangela SP)
  const partial = sellers.find((seller) => {
    const name = normalizeSellerKey(seller.name);
    return name.startsWith(want) || want.startsWith(name);
  });
  return partial ?? null;
}

export async function listNioPapSellers(params?: {
  crmUsuario?: string | null;
  crmSenha?: string | null;
}): Promise<NioPapSeller[]> {
  const body: Record<string, string> = {};
  if (params?.crmUsuario) body.crmUsuario = params.crmUsuario;
  if (params?.crmSenha) body.crmSenha = params.crmSenha;

  const response = await fetch(`${PAP_BASE}/api/sellers`, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await response.json().catch(() => null)) as {
    sellers?: NioPapSeller[];
    error?: string;
  } | null;

  if (!response.ok || !data) {
    throw new Error(data?.error || `Falha HTTP ${response.status} ao listar vendedores do PAP.`);
  }
  return Array.isArray(data.sellers) ? data.sellers : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDocDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

/** GET /api/sync — estado da fila. */
export async function fetchNioPapSyncQueue(): Promise<NioPapSyncJob[]> {
  const response = await fetch(`${PAP_BASE}/api/sync`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as NioPapSyncJob | null;
  if (!response.ok || !data) {
    throw new Error(`Falha HTTP ${response.status} ao consultar a fila do PAP.`);
  }
  return Array.isArray(data.queue) ? data.queue : [];
}

/**
 * Espera o job da fila chegar em done/error.
 * A API nova do nio-pap-crm responde o POST na hora e processa em background.
 */
export async function waitForNioPapSyncJob(
  jobId: string,
  options?: { timeoutMs?: number; intervalMs?: number; documento?: string },
): Promise<NioPapSyncJob> {
  const timeoutMs = options?.timeoutMs ?? 280_000;
  const intervalMs = options?.intervalMs ?? 2_500;
  const wantDoc = normalizeDocDigits(options?.documento);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const queue = await fetchNioPapSyncQueue();
    const byId = queue.find((job) => job.id === jobId);
    const byDoc =
      !byId && wantDoc
        ? [...queue]
            .reverse()
            .find(
              (job) =>
                normalizeDocDigits(job.documento) === wantDoc &&
                (job.status === "done" || job.status === "error" || job.status === "running"),
            )
        : null;
    const job = byId || byDoc;
    if (job?.status === "done") return job;
    if (job?.status === "error") {
      throw new Error(job.error || "O lançamento falhou na fila do PAP.");
    }
    await sleep(intervalMs);
  }
  throw new Error("O lançamento no PAP demorou demais. A pré-venda pode ter entrado — confira no CRM.");
}

/** True se o JSON já é o relatório antigo (sync síncrono). */
export function isNioPapSyncReport(data: unknown): data is NioPapSyncResult {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    "encontrados" in obj ||
    "escolhida" in obj ||
    "resultados" in obj ||
    "resumoWhatsapp" in obj
  );
}

export async function syncNioPapVenda(params: {
  documento: string;
  dias?: number;
  vendedorId: string;
  papMatricula: string;
  papSenha: string;
  crmUsuario: string;
  crmSenha: string;
  /** Nome do vendedor (API nova envia no POST). */
  nome?: string | null;
}): Promise<NioPapSyncResult> {
  const dias = params.dias ?? papDiasDefault();
  const response = await fetch(`${PAP_BASE}/api/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      documento: params.documento,
      dias,
      vendedorId: params.vendedorId,
      papMatricula: params.papMatricula,
      papSenha: params.papSenha,
      crmUsuario: params.crmUsuario,
      crmSenha: params.crmSenha,
      ...(params.nome ? { nome: params.nome } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await response.json().catch(() => null)) as
    | (NioPapSyncResult & NioPapSyncJob)
    | null;
  if (!response.ok || !data) {
    throw new Error(
      (data as { error?: string } | null)?.error ||
        `Falha HTTP ${response.status} no lançamento PAP → CRM.`,
    );
  }
  if (data.error && !data.id && !isNioPapSyncReport(data)) {
    throw new Error(data.error);
  }

  // Compat: API antiga devolvia o relatório no próprio POST
  if (isNioPapSyncReport(data) && !data.id && data.status !== "running" && data.status !== "queued") {
    return data;
  }

  // API nova: job enfileirado — espera o report
  const jobId = data.id;
  if (!jobId) {
    // POST devolveu fila sem id claro: tenta achar o running do mesmo documento
    const queue = Array.isArray(data.queue) ? data.queue : await fetchNioPapSyncQueue();
    const running = [...queue]
      .reverse()
      .find(
        (job) =>
          normalizeDocDigits(job.documento) === normalizeDocDigits(params.documento) &&
          (job.status === "running" || job.status === "queued" || job.status === "done"),
      );
    if (running?.status === "done" && running.report) return running.report;
    if (running?.id) {
      const finished = await waitForNioPapSyncJob(running.id, {
        documento: params.documento,
      });
      if (finished.report) return finished.report;
      throw new Error(finished.error || "Lançamento concluído sem relatório.");
    }
    throw new Error("O PAP não devolveu o id do lançamento na fila.");
  }

  if (data.status === "done" && data.report) return data.report;

  const finished = await waitForNioPapSyncJob(jobId, { documento: params.documento });
  if (finished.report) return finished.report;
  throw new Error(finished.error || "Lançamento concluído sem relatório.");
}

/** Extrai código da pré-venda de campos soltos ou do resumo WhatsApp. */
export function extractPrevendaCodigo(result: NioPapSyncResult): string | null {
  const rows = [
    ...(result.resultados ?? []),
    ...(result.escolhida ? [result.escolhida] : []),
  ];
  for (const row of rows) {
    if (row?.crmCodigo != null && String(row.crmCodigo).trim()) {
      return String(row.crmCodigo).trim();
    }
    const fromUrl = String(row?.crmUrl || "").match(/prevenda=(\d+)/i);
    if (fromUrl?.[1]) return fromUrl[1];
    const fromSkipped = String(row?.skipped || "").match(
      /pr[eé]-?\s*venda\s*[:#]?\s*(\d+)/i,
    );
    if (fromSkipped?.[1]) return fromSkipped[1];
  }
  const resumo = result.resumoWhatsapp || "";
  const fromResumo =
    resumo.match(/Pr[eé]-?\s*venda\s*[:#]?\s*(\d+)/i) ||
    resumo.match(/prevenda=(\d+)/i);
  return fromResumo?.[1] ?? null;
}

/**
 * True quando o PAP/CRM confirma pré-venda (nova ou já existente).
 * Aceita crmCodigo, URL, skipped com número, ou resumo WhatsApp com Pré-venda.
 */
export function vendaFoiLancada(result: NioPapSyncResult): boolean {
  if (extractPrevendaCodigo(result)) return true;
  const resumo = (result.resumoWhatsapp || "").trim();
  if (/pr[eé]-?\s*venda/i.test(resumo) && /cliente\s*:/i.test(resumo)) {
    return true;
  }
  const rows = result.resultados?.length
    ? result.resultados
    : result.escolhida
      ? [result.escolhida]
      : [];
  // Lançou sem código explícito, mas sem erro fatal
  return rows.some(
    (row) =>
      Boolean(row?.crmUrl) &&
      !row?.error &&
      !/n[aã]o\s+lan[cç]ad/i.test(String(row?.skipped || "")),
  );
}

export function formatVendaLancadaMessage(result: NioPapSyncResult): string {
  const escolhida = result.escolhida;
  const launched =
    result.resultados?.find((row) => row?.crmCodigo != null || row?.crmUrl) ||
    escolhida ||
    null;
  const codigo = extractPrevendaCodigo(result);

  const lines = [`✅ *Lançado*`];
  if (codigo) lines.push(`Pré-venda: *${codigo}*`);
  if (escolhida?.nome || launched?.nome) {
    lines.push(`Cliente: *${escolhida?.nome || launched?.nome}*`);
  }
  if (escolhida?.documento || result.documento) {
    lines.push(`Documento: *${escolhida?.documento || result.documento}*`);
  }
  if (escolhida?.numeroPedido) lines.push(`Pedido PAP: *${escolhida.numeroPedido}*`);
  if (escolhida?.data) lines.push(`Data da venda: *${escolhida.data}*`);
  if (result.resumoWhatsapp?.trim()) {
    lines.push("", result.resumoWhatsapp.trim());
  } else if (launched?.crmUrl) {
    lines.push("", launched.crmUrl);
  }
  return lines.join("\n");
}
