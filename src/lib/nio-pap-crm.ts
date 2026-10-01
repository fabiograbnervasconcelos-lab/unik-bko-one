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
  crmCodigo?: string | null;
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
  whatsappEnvios?: Array<{ destino?: string; detalhe?: string }>;
  perguntas?: unknown[];
  error?: string | null;
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

export async function syncNioPapVenda(params: {
  documento: string;
  dias?: number;
  vendedorId: string;
  papMatricula: string;
  papSenha: string;
  crmUsuario: string;
  crmSenha: string;
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
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data = (await response.json().catch(() => null)) as NioPapSyncResult | null;
  if (!response.ok || !data) {
    throw new Error(data?.error || `Falha HTTP ${response.status} no lançamento PAP → CRM.`);
  }
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

/** True quando o PAP/CRM confirma pré-venda criada. */
export function vendaFoiLancada(result: NioPapSyncResult): boolean {
  const rows = result.resultados?.length ? result.resultados : result.escolhida ? [result.escolhida] : [];
  return rows.some((row) => Boolean(row?.crmCodigo) && !row?.skipped && !row?.error);
}

export function formatVendaLancadaMessage(result: NioPapSyncResult): string {
  const escolhida = result.escolhida;
  const launched =
    result.resultados?.find((row) => row?.crmCodigo) ||
    (escolhida?.crmCodigo ? escolhida : null);

  const lines = [`✅ *Lançado*`];
  if (launched?.crmCodigo) lines.push(`Pré-venda: *${launched.crmCodigo}*`);
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
  }
  return lines.join("\n");
}
