import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatComplementLabel,
  getCombinacaoOptionsForLevel,
  needsComplementSelection,
  parseCepInput,
  parseHouseNumberInput,
  type NioCombinacao,
} from "./nio-cobertura.ts";
import {
  afterCoberturaMessage,
  askCoberturaComplementoMessage,
  askCoberturaEnderecoMessage,
  coberturaComplementoOptions,
  coberturaEnderecoOptions,
  declinesCobertura,
  indexToLetterCode,
  letterCodeToIndex,
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
  assert.equal(parseCepInput("88888-888"), "88888888");
  assert.equal(parseCepInput("123"), null);
});

test("parseHouseNumberInput", () => {
  assert.equal(parseHouseNumberInput("369"), "369");
  assert.equal(parseHouseNumberInput("888"), "888");
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

test("letras AA+ para listas longas de complemento", () => {
  assert.equal(indexToLetterCode(0), "A");
  assert.equal(indexToLetterCode(25), "Z");
  assert.equal(indexToLetterCode(26), "AA");
  assert.equal(indexToLetterCode(27), "AB");
  assert.equal(letterCodeToIndex("A"), 0);
  assert.equal(letterCodeToIndex("Z"), 25);
  assert.equal(letterCodeToIndex("AA"), 26);
  assert.equal(parseCoberturaEnderecoPick("AA", 30), 26);
  assert.equal(parseCoberturaEnderecoPick("AB", 30), 27);
});

test("cascata de complemento: Bloco depois Apartamento", () => {
  const combinacoes: NioCombinacao[] = [
    {
      id: "1",
      niveis: 2,
      complementos: [
        { tipo: "BL", valor: "A1", descricao: "Bloco" },
        { tipo: "AP", valor: "101", descricao: "Apartamento" },
      ],
    },
    {
      id: "2",
      niveis: 2,
      complementos: [
        { tipo: "BL", valor: "A1", descricao: "Bloco" },
        { tipo: "AP", valor: "102", descricao: "Apartamento" },
      ],
    },
    {
      id: "3",
      niveis: 2,
      complementos: [
        { tipo: "BL", valor: "A2", descricao: "Bloco" },
        { tipo: "AP", valor: "101", descricao: "Apartamento" },
      ],
    },
  ];

  assert.equal(needsComplementSelection(2, combinacoes), true);
  assert.equal(needsComplementSelection(0, combinacoes), false);

  const level1 = getCombinacaoOptionsForLevel(combinacoes, 1, []);
  assert.equal(level1.length, 2);
  assert.equal(level1[0].label, "Bloco, A1");
  assert.equal(level1[1].label, "Bloco, A2");
  assert.equal(formatComplementLabel(level1[0]), "Bloco, A1");

  const level2 = getCombinacaoOptionsForLevel(combinacoes, 2, [
    { tipo: "BL", valor: "A1", descricao: "Bloco" },
  ]);
  assert.equal(level2.length, 2);
  assert.equal(level2[0].label, "Apartamento, 101");
  assert.equal(level2[1].label, "Apartamento, 102");

  const msg = askCoberturaComplementoMessage(coberturaComplementoOptions(level1), 1);
  assert.match(msg, /Escolha o \*complemento\*/);
  assert.match(msg, /\*A\* — Bloco, A1/);
  assert.match(msg, /\*B\* — Bloco, A2/);
});
