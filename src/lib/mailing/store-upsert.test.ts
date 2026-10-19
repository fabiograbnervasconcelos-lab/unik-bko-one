import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { upsertLeadByKey } from "./store.ts";
import type { MailingLead } from "./types.ts";

function baseLead(
  patch: Partial<MailingLead> & Pick<MailingLead, "name" | "phone" | "papId">,
): Omit<MailingLead, "id" | "createdAt" | "updatedAt"> {
  return {
    source: "pap",
    queue: "transferir",
    name: patch.name,
    phone: patch.phone,
    document: patch.document,
    papId: patch.papId,
    saleType: patch.saleType,
  };
}

describe("upsertLeadByKey allowDuplicateCpf", () => {
  it("skips duplicate CPF by default", () => {
    const first = upsertLeadByKey([], baseLead({
      name: "Ana",
      phone: "11999990001",
      document: "12345678901",
      papId: "p1",
      saleType: "interesse",
    }));
    const second = upsertLeadByKey(first.leads, baseLead({
      name: "Ana 2",
      phone: "11999990002",
      document: "12345678901",
      papId: "p2",
      saleType: "interesse",
    }));
    assert.equal(second.skipped, true);
    assert.equal(second.skipReason, "cpf");
    assert.equal(second.leads.length, 1);
  });

  it("allows duplicate CPF for Venda (new papId creates new lead)", () => {
    const first = upsertLeadByKey([], baseLead({
      name: "Ana",
      phone: "11999990001",
      document: "12345678901",
      papId: "p1",
      saleType: "venda",
    }));
    const second = upsertLeadByKey(
      first.leads,
      baseLead({
        name: "Ana",
        phone: "11999990001",
        document: "12345678901",
        papId: "p2",
        saleType: "venda",
      }),
      { allowDuplicateCpf: true },
    );
    assert.equal(second.skipped, false);
    assert.equal(second.created, true);
    assert.equal(second.leads.length, 2);
  });

  it("still updates same papId when allowDuplicateCpf", () => {
    const first = upsertLeadByKey([], baseLead({
      name: "Ana",
      phone: "11999990001",
      document: "12345678901",
      papId: "p1",
      saleType: "venda",
    }));
    const second = upsertLeadByKey(
      first.leads,
      baseLead({
        name: "Ana Atualizada",
        phone: "11999990001",
        document: "12345678901",
        papId: "p1",
        saleType: "venda",
      }),
      { allowDuplicateCpf: true },
    );
    assert.equal(second.created, false);
    assert.equal(second.skipped, false);
    assert.equal(second.leads.length, 1);
    assert.equal(second.lead.name, "Ana Atualizada");
  });
});
