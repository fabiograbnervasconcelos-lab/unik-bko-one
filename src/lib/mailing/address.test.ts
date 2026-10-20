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

  it("usa localidade do PAP como cidade e prefere Instalação", () => {
    const { parts, full } = extractPapAddress({
      enderecos: [
        { tipo: "Cobrança", complementos: [] },
        {
          tipo: "Instalação",
          logradouro: "Rua Governador Pedro Ivo Campos",
          numero: "133",
          bairro: "Jardim Eldorado",
          localidade: "Palhoça",
          uf: "SC",
          cep: "88133580",
        },
      ],
    });
    assert.equal(parts.logradouro, "Rua Governador Pedro Ivo Campos");
    assert.equal(parts.numero, "133");
    assert.equal(parts.bairro, "Jardim Eldorado");
    assert.equal(parts.cidade, "Palhoça");
    assert.match(full, /Palhoça - SC/);
  });

  it("lê dadosCliente.endereco string", () => {
    const { full } = extractPapAddress({
      dadosCliente: { endereco: "Rua A, 10, Centro" },
    });
    assert.equal(full, "Rua A, 10, Centro");
  });
});
