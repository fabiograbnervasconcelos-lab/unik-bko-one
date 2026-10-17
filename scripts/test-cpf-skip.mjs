#!/usr/bin/env node
import assert from "node:assert/strict";

function onlyDigits(v = "") {
  return String(v).replace(/\D+/g, "");
}

function findLeadByCpf(leads, document) {
  const docKey = onlyDigits(document || "");
  if (!docKey || docKey.length < 11) return -1;
  return leads.findIndex((item) => onlyDigits(item.document || "") === docKey);
}

function upsert(leads, lead) {
  const docKey = onlyDigits(lead.document || "");
  const normalizedDoc = docKey.length >= 11 ? docKey : "";
  if (normalizedDoc) {
    const byCpf = findLeadByCpf(leads, normalizedDoc);
    if (byCpf >= 0) {
      return { leads, created: false, skipped: true, skipReason: "cpf", lead: leads[byCpf] };
    }
  }
  const created = { ...lead, document: normalizedDoc || lead.document, id: "new" };
  return { leads: [...leads, created], created: true, skipped: false, lead: created };
}

const existing = [{ id: "1", name: "A", phone: "11999999999", document: "41062636880" }];
const r1 = upsert(existing, { name: "B", phone: "11888888888", document: "410.626.368-80" });
assert.equal(r1.skipped, true);
assert.equal(r1.skipReason, "cpf");
assert.equal(r1.leads.length, 1);

const r2 = upsert(existing, { name: "C", phone: "11777777777", document: "12345678901" });
assert.equal(r2.created, true);
assert.equal(r2.leads.length, 2);

console.log(JSON.stringify({ ok: true }));
