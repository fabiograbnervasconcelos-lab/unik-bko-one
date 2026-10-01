import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatVendaLancadaMessage,
  matchSellerByCrmUser,
  vendaFoiLancada,
} from "./nio-pap-crm.ts";

test("matchSellerByCrmUser casa login com nome da lista", () => {
  const sellers = [
    { id: "3", name: "AFONSO" },
    { id: "29", name: "ELISANGELA" },
    { id: "18", name: "NATHALIASP" },
  ];
  assert.equal(matchSellerByCrmUser(sellers, "Elisangela")?.id, "29");
  assert.equal(matchSellerByCrmUser(sellers, "ELISANGELA")?.id, "29");
  assert.equal(matchSellerByCrmUser(sellers, "nathaliasp")?.id, "18");
  assert.equal(matchSellerByCrmUser(sellers, "naoexiste"), null);
});

test("vendaFoiLancada exige crmCodigo sem skipped/error", () => {
  assert.equal(
    vendaFoiLancada({
      escolhida: { numeroPedido: "1" },
      resultados: [{ crmCodigo: "PV123" }],
    }),
    true,
  );
  assert.equal(
    vendaFoiLancada({
      escolhida: { numeroPedido: "1" },
      resultados: [{ skipped: "já existe" }],
    }),
    false,
  );
  assert.equal(vendaFoiLancada({ encontrados: 0, escolhida: null }), false);
});

test("formatVendaLancadaMessage começa com Lançado", () => {
  const text = formatVendaLancadaMessage({
    documento: "591.028.530-00",
    escolhida: {
      nome: "JOAO",
      numeroPedido: "99",
      data: "01/10/2026",
      documento: "591.028.530-00",
    },
    resultados: [{ crmCodigo: "555", nome: "JOAO" }],
    resumoWhatsapp: "NIO Fibra\nok",
  });
  assert.match(text, /^\✅ \*Lançado\*/);
  assert.match(text, /Pré-venda: \*555\*/);
  assert.match(text, /Pedido PAP: \*99\*/);
});
