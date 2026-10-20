import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareBrDate,
  isoToBrDate,
  parseBrDate,
  splitDateRangeDaily,
  windowsFromResume,
} from "./pap-date-windows.ts";

describe("pap-date-windows", () => {
  it("isoToBrDate", () => {
    assert.equal(isoToBrDate("2026-08-19T12:00:00Z"), "19/08/2026");
    assert.equal(isoToBrDate("19/08/2026"), "19/08/2026");
  });

  it("splitDateRangeDaily 19→21/08", () => {
    const from = parseBrDate("19/08/2026")!;
    const to = parseBrDate("21/08/2026")!;
    const wins = splitDateRangeDaily(from, to);
    assert.deepEqual(
      wins.map((w) => w.fromBr),
      ["19/08/2026", "20/08/2026", "21/08/2026"],
    );
  });

  it("windowsFromResume a partir do último lead", () => {
    const wins = windowsFromResume("19/08/2026", "21/08/2026");
    assert.equal(wins.length, 3);
    assert.equal(wins[0]!.fromBr, "19/08/2026");
    assert.equal(wins[2]!.toBr, "21/08/2026");
    assert.ok(compareBrDate("19/08/2026", "21/08/2026") < 0);
  });
});
