import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPapClientIdentity } from "./pap-scraper.ts";

describe("extractPapClientIdentity", () => {
  it("lê cpf e email de dadosCliente", () => {
    const id = extractPapClientIdentity({
      dadosCliente: {
        cpf: "025.414.030-03",
        email: "ll8015005@gmail.com",
      },
    });
    assert.equal(id.cpf, "02541403003");
    assert.equal(id.email, "ll8015005@gmail.com");
  });

  it("pega email em contatos quando dadosCliente.email vazio", () => {
    const id = extractPapClientIdentity({
      dadosCliente: {
        cpf: "12345678901",
        contatos: [{ telefone: "51999999999", email: "a@b.com" }],
      },
    });
    assert.equal(id.cpf, "12345678901");
    assert.equal(id.email, "a@b.com");
  });
});
