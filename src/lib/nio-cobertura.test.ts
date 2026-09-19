import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCepInput, parseHouseNumberInput } from "./nio-cobertura.ts";
import { menuMessage, optionFromText } from "./vendor-helpers.ts";

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
