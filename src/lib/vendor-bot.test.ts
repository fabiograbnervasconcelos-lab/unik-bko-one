import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askLoginMessage,
  buildRowFromText,
  dateInCurrentMonth,
  detectStatus,
  extractAgenda,
  extractCpf,
  extractOs,
  filterRows,
  formatQueryResult,
  formatQueryResultMessages,
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

test("extrai OS, CPF e Agen. (não o #id)", () => {
  const block = `
#14027
18/09/2026 - 17:26:45
ELISANGELA
JOAO CARLOS DOS SANTOS
(48) 99999-0000
591.028.530-00
AGENDADO
Agen.: 19/09/2026 (Manhã)
OS: 11194391
`;
  assert.equal(extractOs(block), "11194391");
  assert.equal(extractCpf(block), "591.028.530-00");
  assert.deepEqual(extractAgenda(block), { full: "19/09/2026 (Manhã)", date: "19/09/2026" });
  const row = buildRowFromText(block, "agendados");
  assert.equal(row?.os, "11194391");
  assert.equal(row?.agenda, "19/09/2026 (Manhã)");
  assert.equal(row?.cpf, "591.028.530-00");
  assert.equal(row?.name, "JOAO CARLOS DOS SANTOS");
});

test("ignora período (null) no Agen.", () => {
  assert.deepEqual(extractAgenda("Agen.: 19/09/2026 (null)"), {
    full: "19/09/2026",
    date: "19/09/2026",
  });
});

test("filtra mês vigente pela data de agendamento", () => {
  const now = new Date(2026, 8, 19);
  const rows = [
    {
      name: "A",
      os: "1",
      cpf: null,
      status: "instalado",
      agenda: "10/09/2026 (Manhã)",
      agendaDate: "10/09/2026",
      date: "10/09/2026",
      raw: "",
    },
    {
      name: "B",
      os: "2",
      cpf: null,
      status: "instalado",
      agenda: "10/08/2026 (Tarde)",
      agendaDate: "10/08/2026",
      date: "10/08/2026",
      raw: "",
    },
  ];
  assert.equal(filterRows("instalados", rows, now).length, 1);
  assert.equal(dateInCurrentMonth("19/09/2026", now), true);
});

test("layout instalados/agendados com Agen OS CPF e sem 'e mais N'", () => {
  const text = formatQueryResult({
    kind: "agendados",
    title: "Agendados",
    count: 2,
    monthLabel: "setembro de 2026",
    queriedAt: "19/09/2026 às 15:30",
    rows: [
      {
        name: "JOAO CARLOS DOS SANTOS",
        os: "11194391",
        cpf: "591.028.530-00",
        status: "agendado",
        agenda: "19/09/2026 (Manhã)",
        agendaDate: "19/09/2026",
        date: "19/09/2026",
        raw: "",
      },
      {
        name: "MARIA SILVA",
        os: "222",
        cpf: "111.222.333-44",
        status: "agendado",
        agenda: "20/09/2026 (Tarde)",
        agendaDate: "20/09/2026",
        date: "20/09/2026",
        raw: "",
      },
    ],
  });
  assert.match(text, /Quantidade: 2/);
  assert.match(text, /Agen\.: 19\/09\/2026 \(Manhã\)/);
  assert.match(text, /OS: 11194391/);
  assert.match(text, /CPF: 591\.028\.530-00/);
  assert.doesNotMatch(text, /e mais \*\d+/);
  assert.doesNotMatch(text, /OS #/);
  assert.match(text, /Consulta realizada em 19\/09\/2026 às 15:30/);
});

test("envia todos os registros em mensagens fatiadas sem omitir", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    name: `Cliente ${i + 1} Nome Completo Teste`,
    os: String(10000000 + i),
    cpf: "591.028.530-00",
    status: "agendado",
    agenda: "19/09/2026 (Manhã)",
    agendaDate: "19/09/2026",
    date: "19/09/2026",
    raw: "",
  }));
  const messages = formatQueryResultMessages({
    kind: "agendados",
    title: "Agendados",
    count: 60,
    monthLabel: "setembro de 2026",
    queriedAt: "19/09/2026 às 15:30",
    rows,
  });
  assert.ok(messages.length >= 2);
  const joined = messages.join("\n");
  assert.match(joined, /Cliente 60/);
  assert.doesNotMatch(joined, /e mais \*\d+/);
});

test("menu CRM ONE com emojis e rodapé de consulta", () => {
  assert.match(askLoginMessage(), /usuário/i);
  const menu = loggedInMessage("Elisangela", "19/09/2026 às 15:36");
  assert.match(menu, /Logado/);
  assert.match(menu, /Menu CRM ONE \(NIO\)/);
  assert.match(menu, /1️⃣/);
  assert.match(menu, /7️⃣/);
  assert.match(menu, /Consulta realizada em 19\/09\/2026 às 15:36/);
  assert.match(menuMessage("Elisangela"), /Menu CRM ONE/);
});

test("optionFromText mapeia 1-7 e emojis", () => {
  assert.equal(optionFromText("1"), "instalados");
  assert.equal(optionFromText("1️⃣"), "instalados");
  assert.equal(optionFromText("3 quebra"), "quebra");
  assert.equal(optionFromText("7"), "encerrar");
  assert.equal(optionFromText("encerrar"), "encerrar");
});
