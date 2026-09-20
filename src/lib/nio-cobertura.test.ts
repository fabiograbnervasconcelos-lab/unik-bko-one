import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCepInput, parseHouseNumberInput } from "./nio-cobertura.ts";
import {
  afterCoberturaMessage,
  askCoberturaEnderecoMessage,
  coberturaEnderecoOptions,
  declinesCobertura,
  menuMessage,
  optionFromText,
  parseCoberturaEnderecoPick,
  wantsAnotherCobertura,
} from "./vendor-helpers.ts";

test("menu tem cobertura na 7 e encerrar na 8", () => {
  const menu = menuMessage("Elisangela");
  assert.match(menu, /7️⃣ Cobertura/);
  assert.match(menu, /8️⃣ Encerrar/);
  assert.doesNotMatch(menu, /7️⃣ Encerrar/);
});

test("optionFromText mapeia 7=cobertura e 8=encerrar", () => {
  assert.equal(optionFromText("7"), "cobertura");
  assert.equal(optionFromText("cobertura"), "cobertura");
  assert.equal(optionFromText("8"), "encerrar");
  assert.equal(optionFromText("encerrar"), "encerrar");
});

test("parseCepInput aceita máscara", () => {
  assert.equal(parseCepInput("89056-161"), "89056161");
  assert.equal(parseCepInput("89056161"), "89056161");
  assert.equal(parseCepInput("123"), null);
});

test("parseHouseNumberInput", () => {
  assert.equal(parseHouseNumberInput("369"), "369");
  assert.equal(parseHouseNumberInput("SN"), "SN");
  assert.equal(parseHouseNumberInput("sem número"), "SN");
});

test("escolha de endereço usa letras A/B e não conflita com menu 1", () => {
  assert.equal(parseCoberturaEnderecoPick("A", 2), 0);
  assert.equal(parseCoberturaEnderecoPick("b", 2), 1);
  assert.equal(parseCoberturaEnderecoPick("1", 2), 0);
  assert.equal(optionFromText("1"), "instalados");
  const msg = askCoberturaEnderecoMessage(
    coberturaEnderecoOptions([
      { descricao: "Rua Um 369" },
      { descricao: "Rua Dois 369" },
    ]),
  );
  assert.match(msg, /\*A\* — Rua Um 369/);
  assert.match(msg, /\*B\* — Rua Dois 369/);
  assert.doesNotMatch(msg, /1️⃣/);
});

test("pós-cobertura: S/sim = outra, N/não = sair", () => {
  assert.equal(wantsAnotherCobertura("S"), true);
  assert.equal(wantsAnotherCobertura("sim"), true);
  assert.equal(wantsAnotherCobertura("outra"), true);
  assert.equal(wantsAnotherCobertura("não"), false);
  assert.equal(wantsAnotherCobertura("nao"), false);
  assert.equal(wantsAnotherCobertura("N"), false);

  assert.equal(declinesCobertura("N"), true);
  assert.equal(declinesCobertura("não"), true);
  assert.equal(declinesCobertura("nao"), true);
  assert.equal(declinesCobertura("sim"), false);
  assert.equal(declinesCobertura("S"), false);

  const after = afterCoberturaMessage();
  assert.match(after, /\*S\* — Sim/);
  assert.match(after, /\*N\* — Não/);
});
