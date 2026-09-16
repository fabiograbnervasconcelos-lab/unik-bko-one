import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanGedAnalysisValue, extractGedAnalysis, isJunkGedAnalysis, isValidateAndSendCommand } from "./text.ts";

const SCREENSHOT_PAGE = `
Nº da O.S: -
ID GPON/Acesso: -
Nº ID Bundle: -
Nº do IMEI: -
Data de Digitalização: 14/09/2026 20:26:16
Data de Envio da Digitalização: 14/09/2026 20:26:16
Data de Conferência: 14/09/2026 20:26:22
Login: TT635008
Código PDV: 1069022
Razão Social: ONE TELECOM LTDA
Tipo de Serviço: BIOMETRIA
Opções de Apoio: -
Nome do Plano: -
Resultado da Análise: Doc. Apto para Venda
Status da Digitalização: Conferido
Local de Digitalização: PDV
Linha(s): (41)96750-8745
Regional
RSUL
`;

test("lê Doc. Apto para Venda no layout da tela, ignorando Regional RSUL", () => {
  assert.equal(extractGedAnalysis(SCREENSHOT_PAGE), "Doc. Apto para Venda");
});

test("continua certo se o bloco sobe na tela (menos campos acima)", () => {
  const short = `
Tipo de Serviço: BIOMETRIA
Resultado da Análise: Doc. Apto para Venda
Status da Digitalização: Conferido
Local de Digitalização: PDV
Regional RSUL
`;
  assert.equal(extractGedAnalysis(short), "Doc. Apto para Venda");
});

test("continua certo se o bloco desce (mais linhas acima)", () => {
  const lower = `
Nº da O.S: 998877
ID GPON/Acesso: 123
Nº ID Bundle: 456
Nº do IMEI: 860000
Nome do Plano: Fibra 500
Resultado da Análise: Documento não apto
Status da Digitalização: Conferido
Regional
RSUL
`;
  assert.equal(extractGedAnalysis(lower), "Documento não apto");
});

test("corta o texto colado na mesma linha e não devolve Regional", () => {
  const glued =
    "Resultado da Análise: Doc. Apto para Venda Status da Digitalização: Conferido Local de Digitalização: PDV Linha(s): (41)96750-8745 Regional RSUL";
  assert.equal(extractGedAnalysis(glued), "Doc. Apto para Venda");
});

test("aceita o valor na linha de baixo do rótulo", () => {
  const stacked = "Resultado da Análise:\nDoc. Apto para Venda\nStatus da Digitalização:\nConferido\nRegional\nRSUL";
  assert.equal(extractGedAnalysis(stacked), "Doc. Apto para Venda");
});

test("não pega Regional quando rótulos e valores estão em colunas separadas", () => {
  const columns = `
Nº da O.S
ID GPON/Acesso
Nº ID Bundle
Nº do IMEI
Data de Digitalização
Data de Envio da Digitalização
Data de Conferência
Login
Código PDV
Razão Social
Tipo de Serviço
Opções de Apoio
Nome do Plano
Resultado da Análise
Status da Digitalização
Local de Digitalização
Linha(s)
Regional
-
-
-
-
14/09/2026 20:26:16
14/09/2026 20:26:16
14/09/2026 20:26:22
TT635008
1069022
ONE TELECOM LTDA
BIOMETRIA
-
-
Doc. Apto para Venda
Conferido
PDV
(41)96750-8745
RSUL
`;
  assert.equal(extractGedAnalysis(columns), "Doc. Apto para Venda");
});

test("não pega Regional se ele vier na linha seguinte ao rótulo (coluna da esquerda)", () => {
  const leftColumn = `
Resultado da Análise
Regional
Doc. Apto para Venda
RSUL
`;
  assert.equal(extractGedAnalysis(leftColumn), "Doc. Apto para Venda");
});

test("não trata Regional / RSUL / Conferido como resultado", () => {
  assert.equal(isJunkGedAnalysis("Regional"), true);
  assert.equal(isJunkGedAnalysis("Regional RSUL"), true);
  assert.equal(isJunkGedAnalysis("RSUL"), true);
  assert.equal(isJunkGedAnalysis("Conferido"), true);
  assert.equal(isJunkGedAnalysis("Doc. Apto para Venda"), false);
  assert.equal(cleanGedAnalysisValue("Regional RSUL"), null);
});

test("comando validar e enviar", () => {
  assert.equal(isValidateAndSendCommand("validar e enviar"), true);
  assert.equal(isValidateAndSendCommand("Validar e Enviar"), true);
  assert.equal(isValidateAndSendCommand("  VALIDAR E ENVIAR  "), true);
  assert.equal(isValidateAndSendCommand("oi"), false);
  assert.equal(isValidateAndSendCommand("enviar depois"), false);
});
