/** Consulta de cobertura Nio Fibra via APIs oficiais do site. */

const NIO_BASE = "https://www.niointernet.com.br";

export type NioLogradouro = {
  addressId: string;
  descricao: string;
  tipoLogradouro?: string;
  nomeLogradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  temFachada?: boolean;
};

export type NioCoberturaState = {
  step: "cep" | "numero" | "endereco" | "done";
  cep: string | null;
  numero: string | null;
  hash: string | null;
  logradouros: NioLogradouro[];
};

async function nioFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${NIO_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Origin: NIO_BASE,
      Referer: `${NIO_BASE}/fibra-disponivel/`,
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    logNioDebug(path, response.status, text.slice(0, 200));
  }
  return { ok: response.ok, status: response.status, data };
}

function logNioDebug(path: string, status: number, snippet: string) {
  // Evita import circular com store — só console no servidor.
  console.warn(`[nio-cobertura] ${status} ${path} ${snippet}`);
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function parseCepInput(text: string): string | null {
  const digits = onlyDigits(text);
  if (digits.length === 8) return digits;
  return null;
}

export function parseHouseNumberInput(text: string): string | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  if (/^(s\/?n|sem numero|sem número)$/i.test(cleaned)) return "SN";
  const digits = onlyDigits(cleaned);
  if (digits.length >= 1 && digits.length <= 6) return digits;
  // aceita "369A" etc.
  if (/^[0-9]{1,6}[A-Za-z]?$/.test(cleaned.replace(/\s+/g, ""))) {
    return cleaned.replace(/\s+/g, "").toUpperCase();
  }
  return null;
}

export async function startNioAddressLookup(cep: string, numero: string) {
  const created = await nioFetch("/api/rest/serviceability/address", {
    method: "POST",
    body: JSON.stringify({ cep: onlyDigits(cep), numero: String(numero).trim() || "0" }),
  });
  if (!created.ok || !created.data || typeof created.data !== "object") {
    throw new Error("NIO_ADDRESS_START_FAILED");
  }
  const hash = String((created.data as { hash?: string }).hash || "");
  if (!hash) throw new Error("NIO_ADDRESS_START_FAILED");

  let last: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await nioFetch(`/api/rest/serviceability/${hash}`);
    if (current.ok && current.data && typeof current.data === "object") {
      last = current.data as Record<string, unknown>;
      const status = String(last.status || "").toUpperCase();
      if (status && status !== "PENDENTE") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  if (!last) throw new Error("NIO_ADDRESS_TIMEOUT");

  const status = String(last.status || "").toUpperCase();
  const rawList = Array.isArray(last.logradouros) ? last.logradouros : [];
  const logradouros: NioLogradouro[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const addressId = row.addressId != null ? String(row.addressId) : "";
    if (!addressId) continue;
    logradouros.push({
      addressId,
      descricao: String(row.descricao || ""),
      tipoLogradouro: row.tipoLogradouro != null ? String(row.tipoLogradouro) : undefined,
      nomeLogradouro: row.nomeLogradouro != null ? String(row.nomeLogradouro) : undefined,
      bairro: row.bairro != null ? String(row.bairro) : undefined,
      cidade: row.cidade != null ? String(row.cidade) : undefined,
      uf: row.uf != null ? String(row.uf) : undefined,
      cep: row.cep != null ? String(row.cep) : undefined,
      temFachada: row.temFachada !== false,
    });
  }
  if (status === "ENDERECO_NAO_ENCONTRADO" || !logradouros.length) {
    return { hash, status, logradouros: [] as NioLogradouro[] };
  }
  return { hash, status, logradouros };
}

export async function confirmNioViability(params: {
  hash: string;
  addressId: string;
  numero: string;
}) {
  const { hash, addressId, numero } = params;
  const putAddr = await nioFetch(`/api/rest/serviceability/${hash}/address`, {
    method: "PUT",
    body: JSON.stringify({ addressId: String(addressId), numero: String(numero).trim() || "SN" }),
  });
  if (!putAddr.ok) throw new Error("NIO_SELECT_ADDRESS_FAILED");

  const putComp = await nioFetch(`/api/rest/serviceability/${hash}/complement`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
  if (!putComp.ok) throw new Error("NIO_COMPLEMENT_FAILED");

  const putVia = await nioFetch(`/api/rest/serviceability/${hash}/viability`, {
    method: "PUT",
  });
  if (!putVia.ok || !putVia.data || typeof putVia.data !== "object") {
    throw new Error("NIO_VIABILITY_FAILED");
  }
  const data = putVia.data as Record<string, unknown>;
  const status = String(data.status || data.viabilidade || "").toUpperCase();
  const viavel =
    data.viavel === true ||
    status === "VIAVEL" ||
    status === "AVAILABLE" ||
    status === "OK";
  const indisponivel =
    status === "INVIAVEL" ||
    status === "PARTIAL" ||
    status === "PARCIAL" ||
    data.viavel === false;

  return {
    viavel: viavel && !indisponivel,
    status,
    description: data.availabilityDescription != null ? String(data.availabilityDescription) : null,
    maxBandwidth: data.maxBandwidth != null ? String(data.maxBandwidth) : null,
    raw: data,
  };
}

export function emptyCoberturaState(): NioCoberturaState {
  return {
    step: "cep",
    cep: null,
    numero: null,
    hash: null,
    logradouros: [],
  };
}
