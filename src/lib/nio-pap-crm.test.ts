import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPrevendaCodigo,
  formatVendaLancadaMessage,
  isNioPapSyncReport,
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

test("vendaFoiLancada aceita crmCodigo mesmo com skipped (já existia)", () => {
  assert.equal(
    vendaFoiLancada({
      escolhida: { numeroPedido: "1" },
      resultados: [{ crmCodigo: "16029", skipped: "já existe" }],
    }),
    true,
  );
  assert.equal(
    vendaFoiLancada({
      escolhida: { numeroPedido: "1" },
      resultados: [{ skipped: "já existe sem código" }],
      resumoWhatsapp: "NIO Fibra\nPré-venda: 16029\nCliente: TESTE",
    }),
    true,
  );
  assert.equal(vendaFoiLancada({ encontrados: 0, escolhida: null }), false);
});

test("extractPrevendaCodigo lê URL e resumo", () => {
  assert.equal(
    extractPrevendaCodigo({
      resultados: [
        {
          crmUrl:
            "https://uniktelecom.com.br/proadmin/alterarPrevendas.php?active=prevendas16029&prevenda=16029&operadora=8",
        },
      ],
    }),
    "16029",
  );
  assert.equal(
    extractPrevendaCodigo({
      resumoWhatsapp: "NIO Fibra\nPré-venda: 16029\nCliente: X",
    }),
    "16029",
  );
});

test("isNioPapSyncReport distingue job da fila do relatório final", () => {
  assert.equal(
    isNioPapSyncReport({
      id: "abc",
      status: "running",
      documento: "921.130.100-97",
      queue: [],
    }),
    false,
  );
  assert.equal(
    isNioPapSyncReport({
      documento: "921.130.100-97",
      dias: 30,
      encontrados: 1,
      escolhida: { numeroPedido: "1" },
      resumoWhatsapp: "Pré-venda: 16100",
    }),
    true,
  );
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
