/**
 * Monta endereço completo BR a partir de campos soltos do PAP/Excel.
 */

import type { MailingLead } from "@/lib/mailing/types";

function str(value: unknown): string {
  return String(value ?? "").trim();
}

export type AddressParts = {
  logradouro?: string;
  endereco?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  municipio?: string;
  uf?: string;
  estado?: string;
  cep?: string;
};

/** Normaliza um objeto de endereço PAP (ou similar) para partes. */
export function normalizeAddressParts(
  raw: Record<string, unknown> | null | undefined,
): AddressParts {
  if (!raw || typeof raw !== "object") return {};
  return {
    logradouro: str(raw.logradouro || raw.endereco || raw.rua || raw.street),
    numero: str(raw.numero || raw.number || raw.num),
    complemento: str(raw.complemento || raw.complement || raw.compl),
    bairro: str(raw.bairro || raw.neighborhood || raw.district),
    cidade: str(raw.cidade || raw.municipio || raw.city),
    uf: str(raw.uf || raw.estado || raw.state).toUpperCase(),
    cep: str(raw.cep || raw.zip || raw.zipCode).replace(/\s/g, ""),
  };
}

/** "Rua X, 123, Apto 4, Bairro Y, Cidade - UF, CEP 00000-000" */
export function formatFullAddress(parts: AddressParts): string {
  const street = str(parts.logradouro || parts.endereco || parts.rua);
  const numero = str(parts.numero);
  const complemento = str(parts.complemento);
  const bairro = str(parts.bairro);
  const cidade = str(parts.cidade || parts.municipio);
  const uf = str(parts.uf || parts.estado).toUpperCase();
  const cep = str(parts.cep);

  const line: string[] = [];
  if (street) {
    line.push(numero ? `${street}, ${numero}` : street);
  } else if (numero) {
    line.push(`nº ${numero}`);
  }
  if (complemento) line.push(complemento);
  if (bairro) line.push(bairro);
  if (cidade && uf) line.push(`${cidade} - ${uf}`);
  else if (cidade) line.push(cidade);
  else if (uf) line.push(uf);
  if (cep) line.push(`CEP ${cep}`);
  return line.join(", ");
}

/**
 * Extrai o primeiro endereço útil de uma venda PAP
 * (enderecos[], dadosCliente.enderecos, dadosCliente.endereco, etc.).
 */
export function extractPapAddress(venda: Record<string, unknown>): {
  parts: AddressParts;
  full: string;
} {
  const dados = (venda.dadosCliente || {}) as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (Array.isArray(venda.enderecos)) candidates.push(...venda.enderecos);
  if (Array.isArray(dados.enderecos)) candidates.push(...dados.enderecos);
  if (venda.endereco) candidates.push(venda.endereco);
  if (dados.endereco) candidates.push(dados.endereco);
  if (dados.enderecoInstalacao) candidates.push(dados.enderecoInstalacao);
  if (venda.enderecoInstalacao) candidates.push(venda.enderecoInstalacao);

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return { parts: { logradouro: item.trim() }, full: item.trim() };
    }
    if (item && typeof item === "object") {
      const parts = normalizeAddressParts(item as Record<string, unknown>);
      const full = formatFullAddress(parts);
      if (full) return { parts, full };
    }
  }

  // Fallback: campos flat no root / dadosCliente
  const flat = normalizeAddressParts({
    logradouro: venda.logradouro || dados.logradouro,
    endereco: venda.enderecoTexto || dados.enderecoTexto,
    numero: venda.numero || dados.numero,
    complemento: venda.complemento || dados.complemento,
    bairro: venda.bairro || dados.bairro,
    cidade: venda.cidade || dados.cidade,
    uf: venda.uf || dados.uf,
    cep: venda.cep || dados.cep,
  });
  return { parts: flat, full: formatFullAddress(flat) };
}

/** Reaplica endereço completo a partir de raw PAP (idempotente). */
export function applyAddressToLead(lead: MailingLead): MailingLead {
  const raw = lead.raw;
  if (!raw || typeof raw !== "object") return lead;
  const { parts, full } = extractPapAddress(raw as Record<string, unknown>);
  if (!full) return lead;
  const already =
    lead.address === full &&
    lead.part2?.enderecoCompleto === full &&
    (lead.city || "") === (parts.cidade || "") &&
    (lead.state || "") === (parts.uf || "") &&
    (lead.zip || "") === (parts.cep || "");
  if (already) return lead;
  return {
    ...lead,
    address: full,
    city: parts.cidade || lead.city,
    state: parts.uf || lead.state,
    zip: parts.cep || lead.zip,
    part2: {
      ...(lead.part2 || {}),
      endereco: parts.logradouro || lead.part2?.endereco || "",
      numero: parts.numero || lead.part2?.numero || "",
      complemento: parts.complemento || lead.part2?.complemento || "",
      bairro: parts.bairro || lead.part2?.bairro || "",
      cidade: parts.cidade || lead.part2?.cidade || "",
      uf: parts.uf || lead.part2?.uf || "",
      cep: parts.cep || lead.part2?.cep || "",
      enderecoCompleto: full,
    },
    updatedAt: lead.updatedAt,
  };
}
