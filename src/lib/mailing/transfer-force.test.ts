import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Espelho da decisão de bloqueio em transferLeads:
 * bloqueia se há treating >24h, a menos que force=true (master/admin).
 */
function decideTransfer(block: { blocked: boolean }, force?: boolean) {
  if (block.blocked && !force) {
    return { ok: false as const, reason: "blocked" };
  }
  return { ok: true as const, forced: Boolean(force && block.blocked) };
}

describe("transfer force override", () => {
  it("bloqueia quando há treating stale e force=false", () => {
    const r = decideTransfer({ blocked: true }, false);
    assert.equal(r.ok, false);
  });

  it("permite quando force=true mesmo com bloqueio", () => {
    const r = decideTransfer({ blocked: true }, true);
    assert.equal(r.ok, true);
    assert.equal(r.forced, true);
  });

  it("permite normalmente sem bloqueio", () => {
    const r = decideTransfer({ blocked: false }, false);
    assert.equal(r.ok, true);
    assert.equal(r.forced, false);
  });
});
