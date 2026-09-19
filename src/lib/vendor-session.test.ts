import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Cópia mínima da lógica de linkVendorJids (sem Playwright) para regressão
 * do bug: 2ª mensagem apagava a sessão quando LID e telefone já eram o mesmo alias.
 */
type Phase = "need_login" | "awaiting_user" | "awaiting_pass" | "menu";
type Session = {
  jid: string;
  phase: Phase;
  pendingUser: string | null;
  crmUser: string | null;
};

function link(sessions: Map<string, Session>, aliases: Map<string, string>, a: string, b: string) {
  if (!a || !b || a === b) return;
  const resolve = (jid: string) => aliases.get(jid) || jid;
  const keyA = resolve(a);
  const keyB = resolve(b);
  if (keyA === keyB) {
    aliases.set(a, keyA);
    aliases.set(b, keyA);
    return;
  }
  const sessionA = sessions.get(keyA);
  const sessionB = sessions.get(keyB);
  let canonical = keyA;
  if (sessionB && !sessionA) canonical = keyB;
  else if (sessionA && sessionB) {
    if (!sessionA.crmUser && sessionB.crmUser) canonical = keyB;
    else if (
      !sessionA.crmUser &&
      !sessionB.crmUser &&
      (sessionB.pendingUser || sessionB.phase === "awaiting_pass") &&
      !(sessionA.pendingUser || sessionA.phase === "awaiting_pass")
    ) {
      canonical = keyB;
    }
  }
  aliases.set(a, canonical);
  aliases.set(b, canonical);
  aliases.set(keyA, canonical);
  aliases.set(keyB, canonical);
  if (canonical === keyA && sessionB && sessionA) {
    if (!sessionA.pendingUser && sessionB.pendingUser) sessionA.pendingUser = sessionB.pendingUser;
    if (sessionB.phase === "awaiting_pass" && sessionA.phase !== "menu") {
      sessionA.phase = sessionB.phase;
    }
    sessions.delete(keyB);
  } else if (canonical === keyB && sessionA && sessionB) {
    if (!sessionB.pendingUser && sessionA.pendingUser) sessionB.pendingUser = sessionA.pendingUser;
    if (sessionA.phase === "awaiting_pass" && sessionB.phase !== "menu") {
      sessionB.phase = sessionA.phase;
    }
    sessions.delete(keyA);
  }
}

test("2ª mensagem com mesmo LID+telefone NÃO apaga sessão mid-login", () => {
  const sessions = new Map<string, Session>();
  const aliases = new Map<string, string>();
  const phone = "554891940908@s.whatsapp.net";
  const lid = "101979837718749@lid";

  link(sessions, aliases, phone, lid);
  sessions.set(phone, {
    jid: phone,
    phase: "awaiting_pass",
    pendingUser: "Elisangela",
    crmUser: null,
  });

  link(sessions, aliases, phone, lid);
  const kept = sessions.get(aliases.get(phone) || phone);
  assert.ok(kept);
  assert.equal(kept.phase, "awaiting_pass");
  assert.equal(kept.pendingUser, "Elisangela");
  assert.equal(sessions.size, 1);
});

test("une sessão LID (com usuário) na chave do telefone sem perder pendingUser", () => {
  const sessions = new Map<string, Session>();
  const aliases = new Map<string, string>();
  const phone = "554891940908@s.whatsapp.net";
  const lid = "101979837718749@lid";

  sessions.set(lid, {
    jid: lid,
    phase: "awaiting_pass",
    pendingUser: "Elisangela",
    crmUser: null,
  });
  sessions.set(phone, {
    jid: phone,
    phase: "need_login",
    pendingUser: null,
    crmUser: null,
  });

  link(sessions, aliases, phone, lid);
  const canonical = aliases.get(phone) || phone;
  const kept = sessions.get(canonical);
  assert.ok(kept);
  assert.equal(kept.pendingUser, "Elisangela");
  assert.equal(kept.phase, "awaiting_pass");
  assert.equal(sessions.size, 1);
});
