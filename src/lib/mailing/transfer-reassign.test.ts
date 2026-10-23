import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Espelho da decisão em transferLeads para pool vs reatribuição entre vendedores.
 */
function applyTransferLead(
  lead: {
    id: string;
    queue: string;
    assignedTo: string | null;
    treatingSince: string | null;
  },
  targetSellerId: string,
  opts: { reassign?: boolean },
) {
  const nowIso = "2026-10-23T18:00:00.000Z";
  if (lead.queue === "transferir") {
    return {
      kind: "assigned" as const,
      queue: "tratando",
      assignedTo: targetSellerId,
      treatingSince: nowIso,
    };
  }
  if (opts.reassign && lead.assignedTo && lead.assignedTo !== targetSellerId) {
    return {
      kind: "reassigned" as const,
      queue: lead.queue,
      assignedTo: targetSellerId,
      treatingSince: lead.queue === "tratando" ? nowIso : lead.treatingSince,
    };
  }
  return { kind: "skipped" as const, queue: lead.queue, assignedTo: lead.assignedTo };
}

describe("transfer reassign entre vendedores", () => {
  it("pool Transferir vira tratando no destino", () => {
    const r = applyTransferLead(
      { id: "1", queue: "transferir", assignedTo: null, treatingSince: null },
      "seller-b",
      { reassign: false },
    );
    assert.equal(r.kind, "assigned");
    assert.equal(r.queue, "tratando");
    assert.equal(r.assignedTo, "seller-b");
  });

  it("sem reassign, lead já atribuído é ignorado", () => {
    const r = applyTransferLead(
      {
        id: "2",
        queue: "tratando",
        assignedTo: "seller-a",
        treatingSince: "2026-10-22T10:00:00.000Z",
      },
      "seller-b",
      { reassign: false },
    );
    assert.equal(r.kind, "skipped");
    assert.equal(r.assignedTo, "seller-a");
  });

  it("com reassign, move tratando A → B e renova timer", () => {
    const r = applyTransferLead(
      {
        id: "3",
        queue: "tratando",
        assignedTo: "seller-a",
        treatingSince: "2026-10-22T10:00:00.000Z",
      },
      "seller-b",
      { reassign: true },
    );
    assert.equal(r.kind, "reassigned");
    assert.equal(r.queue, "tratando");
    assert.equal(r.assignedTo, "seller-b");
    assert.equal(r.treatingSince, "2026-10-23T18:00:00.000Z");
  });

  it("com reassign, fila fechada muda só o dono", () => {
    const r = applyTransferLead(
      {
        id: "4",
        queue: "sem_resposta",
        assignedTo: "seller-a",
        treatingSince: "2026-10-20T10:00:00.000Z",
      },
      "seller-b",
      { reassign: true },
    );
    assert.equal(r.kind, "reassigned");
    assert.equal(r.queue, "sem_resposta");
    assert.equal(r.assignedTo, "seller-b");
    assert.equal(r.treatingSince, "2026-10-20T10:00:00.000Z");
  });

  it("não reatribui para o mesmo vendedor", () => {
    const r = applyTransferLead(
      {
        id: "5",
        queue: "tratando",
        assignedTo: "seller-a",
        treatingSince: "2026-10-22T10:00:00.000Z",
      },
      "seller-a",
      { reassign: true },
    );
    assert.equal(r.kind, "skipped");
  });
});
