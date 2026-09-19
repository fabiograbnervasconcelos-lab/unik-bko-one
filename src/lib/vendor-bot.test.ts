import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askLoginMessage,
  dateInCurrentMonth,
  detectStatus,
  filterRows,
  formatQueryResult,
  loggedInMessage,
  menuMessage,
  optionFromText,
  parseCredentials,
} from "./vendor-helpers.ts";

test("parseCredentials aceita user senha na mesma linha", () => {
  assert.deepEqual(parseCredentials("vendedor01 senha@123"), {
    user: "vendedor01",
    pass: "senha@123",
  });
});

test("parseCredentials aceita duas linhas", () => {
  assert.deepEqual(parseCredentials("vendedor01\nminhaSenha"), {
    user: "vendedor01",
    pass: "minhaSenha",
  });
});

test("parseCredentials aceita usuario: e senha:", () => {
  assert.deepEqual(parseCredentials("usuario: ana.silva senha: segredo"), {
    user: "ana.silva",
    pass: "segredo",
  });
});

test("detectStatus reconhece quebra e ag biometria", () => {
  assert.equal(detectStatus("Cliente X\nTratar Quebra\n01/09/2026"), "tratar quebra");
  assert.equal(detectStatus("Ag. Biometria CPF"), "ag. biometria");
  assert.equal(detectStatus("STATUS: INSTALADO"), "instalado");
});

test("filtra mês vigente em instalados e libera quebra em qualquer mês", () => {
  const now = new Date(2026, 8, 19); // setembro/2026
  const rows = [
    { name: "A", os: "1", status: "instalado", date: "10/09/2026", raw: "" },
    { name: "B", os: "2", status: "instalado", date: "10/08/2026", raw: "" },
    { name: "C", os: "3", status: "tratar quebra", date: "01/01/2025", raw: "" },
  ];
  assert.equal(filterRows("instalados", rows, now).length, 1);
  assert.equal(filterRows("quebra", rows, now).length, 1);
  assert.equal(dateInCurrentMonth("19/09/2026", now), true);
  assert.equal(dateInCurrentMonth("19/08/2026", now), false);
});

test("layout da resposta sempre traz quantidade", () => {
  const text = formatQueryResult({
    kind: "instalados",
    title: "Instalados",
    count: 2,
    monthLabel: "setembro de 2026",
    rows: [
      { name: "Maria Souza", os: "1001", status: "instalado", date: "05/09/2026", raw: "" },
      { name: "José Lima", os: "1002", status: "instalado", date: "08/09/2026", raw: "" },
    ],
  });
  assert.match(text, /Quantidade: 2/);
  assert.match(text, /Maria Souza/);
  assert.match(text, /OS #1001/);
  assert.match(text, /Precisa de mais alguma informação/);
});

test("mensagens de menu e login estão claras", () => {
  assert.match(askLoginMessage(), /usuário e senha/i);
  assert.match(loggedInMessage("vend01"), /Logado/);
  assert.match(menuMessage("vend01"), /\*\(1\)\*/);
  assert.match(menuMessage("vend01"), /\*\(7\)\*/);
});

test("optionFromText mapeia 1-7", () => {
  assert.equal(optionFromText("1"), "instalados");
  assert.equal(optionFromText("3 quebra"), "quebra");
  assert.equal(optionFromText("7"), "encerrar");
  assert.equal(optionFromText("encerrar"), "encerrar");
});
