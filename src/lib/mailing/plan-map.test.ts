import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapPlanLabelByValor,
  parsePlanValorReais,
  resolveMailingPlanLabel,
} from "./plan-map.ts";

describe("plan-map", () => {
  it("parse valores BR e plain", () => {
    assert.equal(parsePlanValorReais("R$ 110,00"), 110);
    assert.equal(parsePlanValorReais("95.00"), 95);
    assert.equal(parsePlanValorReais("70"), 70);
    assert.equal(parsePlanValorReais("NIO 155 FIBRA"), 155);
  });

  it("mapeia faixas pedidas", () => {
    assert.equal(mapPlanLabelByValor(55), "600 mega");
    assert.equal(mapPlanLabelByValor(95), "600 mega");
    assert.equal(mapPlanLabelByValor(110), "600 mega");
    assert.equal(mapPlanLabelByValor(70), "800 mega");
    assert.equal(mapPlanLabelByValor(125), "800 mega");
    assert.equal(mapPlanLabelByValor(140), "800 mega");
    assert.equal(mapPlanLabelByValor(85), "1GB");
    assert.equal(mapPlanLabelByValor(100), "1GB");
    assert.equal(mapPlanLabelByValor(155), "1GB");
    assert.equal(mapPlanLabelByValor(170), "1GB");
    assert.equal(mapPlanLabelByValor(185), "1GB");
    assert.equal(mapPlanLabelByValor(200), "1GB");
  });

  it("resolve com fallback do nome do plano", () => {
    assert.equal(
      resolveMailingPlanLabel({ valorPlano: "R$ 125,00", plano: "NIO FIBRA ULTRA" }),
      "800 mega",
    );
    assert.equal(
      resolveMailingPlanLabel({ valorPlano: "", plano: "Plano especial" }),
      "Plano especial",
    );
  });
});
