#!/usr/bin/env node
/** Smoke: filtro Venda / Aguardando tratamento. */
import assert from "node:assert/strict";

function matchesVendaAguardandoTratamento(venda) {
  const primary = String(venda.chaveStatusPrimario || "").toUpperCase();
  if (primary === "ANALISE_BO") return true;
  const status = String(venda.status || venda.subStatus || "");
  return /aguardando\s*tratamento/i.test(status);
}

assert.equal(
  matchesVendaAguardandoTratamento({
    chaveStatusPrimario: "ANALISE_BO",
    status: "Aguardando tratamento",
  }),
  true,
);
assert.equal(
  matchesVendaAguardandoTratamento({
    chaveStatusPrimario: "MINHAS_PENDENCIAS",
    status: "Minhas Pendências",
  }),
  false,
);
assert.equal(
  matchesVendaAguardandoTratamento({
    chaveStatusPrimario: "VENDA_LIQUIDA",
    status: "Venda",
  }),
  false,
);
assert.equal(
  matchesVendaAguardandoTratamento({
    status: "Aguardando tratamento",
  }),
  true,
);

console.log(JSON.stringify({ ok: true, cases: 4 }));
