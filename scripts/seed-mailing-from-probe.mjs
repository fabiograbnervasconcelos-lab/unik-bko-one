#!/usr/bin/env node
/**
 * Importa os interesses capturados em data/pap-probe/last-vendas-response.json
 * para data/mailing/leads.json (fila transferir).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "data/pap-probe/last-vendas-response.json");
const OUT_DIR = path.join(ROOT, "data/mailing");
const OUT = path.join(OUT_DIR, "leads.json");

function onlyDigits(v = "") {
  return String(v).replace(/\D+/g, "");
}

function onlyPhone(v = "") {
  const d = onlyDigits(v);
  if (d.length >= 12 && d.startsWith("55")) return d.slice(0, 13);
  return d.slice(0, 11);
}

function newId(prefix = "lead") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function mapVenda(venda) {
  const dados = venda.dadosCliente || {};
  const contatos = Array.isArray(dados.contatos) ? dados.contatos : [];
  const phoneRaw = String(contatos[0]?.telefone || contatos[0]?.numero || "");
  const produtos = venda.produtos || {};
  const banda = produtos.bandaLarga || {};
  const vendedor = venda.vendedor || {};
  const enderecos = Array.isArray(venda.enderecos) ? venda.enderecos : [];
  const end = enderecos[0] || {};
  const now = new Date().toISOString();

  const part1 = {
    nome: String(dados.nome || venda.cliente || ""),
    cpf: String(dados.cpf || venda.cpf || ""),
    email: String(dados.email || ""),
    telefone: phoneRaw,
    dataNascimento: String(dados.dataNascimento || ""),
    nomeMae: String(dados.nomeMae || ""),
    genero: String(dados.genero || ""),
    segmento: String(venda.segmento || ""),
    numeroPedido: String(venda.numeroPedido || ""),
    status: String(venda.subStatus || venda.status || ""),
    motivo: String(venda.motivo || ""),
    etapa: String(venda.etapaInteresse || ""),
    dataCriacao: String(venda.dataCriacao || ""),
  };

  const part2 = {
    endereco: String(end.logradouro || end.endereco || end.rua || ""),
    numero: String(end.numero || ""),
    complemento: String(end.complemento || ""),
    bairro: String(end.bairro || ""),
    cidade: String(end.cidade || end.municipio || ""),
    uf: String(end.uf || end.estado || ""),
    cep: String(end.cep || ""),
    vendedor: String(vendedor.nome || ""),
    matriculaVendedor: String(vendedor.matricula || ""),
    pdv: String(vendedor.pdv || ""),
  };

  const planData = {
    plano: String(produtos.comboSolicitado || produtos.comboSugerido || venda.plano || ""),
    velocidade: String(banda.velocidade || ""),
    valorPlano: String(produtos.valorPlano || ""),
    taxaHabilitacao: String(produtos.taxaHabilitacao || ""),
    tecnologia: String(produtos.tecnologiaCombo || banda.tipoProduto || ""),
    formaPagamento: String(venda.pagamento?.formaPagamento || ""),
  };

  return {
    id: newId("lead"),
    source: "pap",
    queue: "transferir",
    name: part1.nome || "Cliente PAP",
    phone: onlyPhone(phoneRaw) || phoneRaw,
    document: onlyDigits(part1.cpf) || undefined,
    email: part1.email || undefined,
    address: [part2.endereco, part2.numero, part2.bairro].filter(Boolean).join(", ") || undefined,
    city: part2.cidade || undefined,
    state: part2.uf || undefined,
    zip: part2.cep || undefined,
    plan: planData.plano || undefined,
    saleType: "interesse",
    saleDate: part1.dataCriacao || undefined,
    papId: String(venda._id || venda.numeroPedido || ""),
    part1,
    part2,
    planData,
    createdAt: now,
    updatedAt: now,
  };
}

if (!fs.existsSync(SRC)) {
  console.error("Arquivo não encontrado:", SRC);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(SRC, "utf8"));
const vendas = payload?.data?.vendas || [];
fs.mkdirSync(OUT_DIR, { recursive: true });

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const byPap = new Map(existing.filter((l) => l.papId).map((l) => [l.papId, l]));

let imported = 0;
let updated = 0;
for (const venda of vendas) {
  const draft = mapVenda(venda);
  const prev = byPap.get(draft.papId);
  if (prev) {
    byPap.set(draft.papId, { ...prev, ...draft, id: prev.id, createdAt: prev.createdAt });
    updated += 1;
  } else {
    byPap.set(draft.papId, draft);
    imported += 1;
  }
}

const withoutPap = existing.filter((l) => !l.papId);
const next = [...withoutPap, ...byPap.values()];
fs.writeFileSync(OUT, JSON.stringify(next, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      vendas: vendas.length,
      imported,
      updated,
      totalLeads: next.length,
      samplePedidos: next
        .filter((l) => l.saleType === "interesse")
        .slice(0, 5)
        .map((l) => l.part1?.numeroPedido),
      out: OUT,
    },
    null,
    2,
  ),
);
