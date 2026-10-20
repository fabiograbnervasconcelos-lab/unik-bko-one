import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPapAddress,
  formatFullAddress,
} from "./address.ts";

describe("formatFullAddress", () => {
  it("monta endereço completo BR", () => {
    assert.equal(
      formatFullAddress({
        logradouro: "Rua das Flores",
        numero: "120",
        complemento: "Apto 3",
        bairro: "Centro",
        cidade: "Florianópolis",
        uf: "SC",
        cep: "88010000",
      }),
      "Rua das Flores, 120, Apto 3, Centro, Florianópolis - SC, CEP 88010000",
    );
  });
});

describe("extractPapAddress", () => {
  it("lê venda.enderecos[0]", () => {
    const { full, parts } = extractPapAddress({
      enderecos: [
        {
          logradouro: "Av. Brasil",
          numero: "500",
          bairro: "Centro",
          cidade: "Joinville",
          uf: "SC",
          cep: "89201000",
        },
      ],
    });
    assert.equal(parts.cidade, "Joinville");
    assert.match(full, /Av\. Brasil, 500/);
    assert.match(full, /Joinville - SC/);
  });

  it("lê dadosCliente.endereco string", () => {
    const { full } = extractPapAddress({
      dadosCliente: { endereco: "Rua A, 10, Centro" },
    });
    assert.equal(full, "Rua A, 10, Centro");
  });
});
