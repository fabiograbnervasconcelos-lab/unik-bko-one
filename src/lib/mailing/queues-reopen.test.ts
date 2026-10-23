import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Regra de reabertura: fila fechada → tratando limpa closedAt e renova treatingSince.
 * (Lógica espelhada do moveLeadQueue — evita depender do store em disco.)
 */
function reopenToTratando(lead: {
  queue: string;
  closedAt: string | null;
  treatingSince: string | null;
  assignedTo: string | null;
}) {
  const nowIso = "2026-10-20T12:00:00.000Z";
  const reopening =
    lead.queue === "sem_interesse" ||
    lead.queue === "sem_resposta" ||
    lead.queue === "vendido" ||
    lead.queue === "ja_contratou_nio";
  return {
    queue: "tratando" as const,
    closedAt: null,
    treatingSince: reopening ? nowIso : lead.treatingSince || nowIso,
    assignedTo: lead.assignedTo,
  };
}

describe("voltar a tratando", () => {
  it("reabre sem_resposta limpando closedAt", () => {
    const next = reopenToTratando({
      queue: "sem_resposta",
      closedAt: "2026-10-19T10:00:00.000Z",
      treatingSince: "2026-10-18T10:00:00.000Z",
      assignedTo: "seller-1",
    });
    assert.equal(next.queue, "tratando");
    assert.equal(next.closedAt, null);
    assert.equal(next.treatingSince, "2026-10-20T12:00:00.000Z");
    assert.equal(next.assignedTo, "seller-1");
  });

  it("reabre ja_contratou_nio limpando closedAt", () => {
    const next = reopenToTratando({
      queue: "ja_contratou_nio",
      closedAt: "2026-10-19T10:00:00.000Z",
      treatingSince: "2026-10-18T10:00:00.000Z",
      assignedTo: "seller-1",
    });
    assert.equal(next.queue, "tratando");
    assert.equal(next.closedAt, null);
    assert.equal(next.treatingSince, "2026-10-20T12:00:00.000Z");
  });
});
