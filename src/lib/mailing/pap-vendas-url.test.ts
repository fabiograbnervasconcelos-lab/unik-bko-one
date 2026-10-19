import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVendasUrlForFrom,
  inferNextVendasUrl,
} from "./pap-vendas-url.ts";

const BASE =
  "https://pap-api.niointernet.com.br/api/portal/vendas?dataInicio=2026-10-01T00%3A00%3A00-03%3A00&dataFim=2026-10-19T23%3A59%3A59-03%3A00&tipoVenda=VENDA&page=34&limit=15";

describe("buildVendasUrlForFrom (PAP page 1-based)", () => {
  it("avança para page 36 quando from=526 (não fica em 35)", () => {
    // Página 35 = 511-525; próxima (526) = page 36
    const url = buildVendasUrlForFrom(BASE.replace("page=34", "page=35"), 526, 15, false);
    assert.ok(url);
    const page = new URL(url!).searchParams.get("page");
    assert.equal(page, "36");
  });

  it("from=1 → page=1", () => {
    const url = buildVendasUrlForFrom(BASE, 1, 15, false);
    assert.equal(new URL(url!).searchParams.get("page"), "1");
  });

  it("from=16 → page=2", () => {
    const url = buildVendasUrlForFrom(BASE, 16, 15, false);
    assert.equal(new URL(url!).searchParams.get("page"), "2");
  });

  it("from=511 → page=35", () => {
    const url = buildVendasUrlForFrom(BASE, 511, 15, false);
    assert.equal(new URL(url!).searchParams.get("page"), "35");
  });

  it("detecta page zero-based quando pageZeroBased=true", () => {
    const url = buildVendasUrlForFrom(BASE.replace("page=34", "page=0"), 526, 15, true);
    assert.equal(new URL(url!).searchParams.get("page"), "35");
  });

  it("bug antigo: cur < page1 NÃO pode manter a mesma página", () => {
    // Com page=35 e from=526, implementação antiga fazia page0=35
    const url = buildVendasUrlForFrom(BASE.replace("page=34", "page=35"), 526, 15);
    assert.equal(new URL(url!).searchParams.get("page"), "36");
  });
});

describe("inferNextVendasUrl", () => {
  it("incrementa page pelo delta observado", () => {
    const prev = BASE.replace("page=34", "page=33");
    const last = BASE.replace("page=34", "page=34");
    const next = inferNextVendasUrl(prev, last);
    assert.equal(new URL(next!).searchParams.get("page"), "35");
  });
});
