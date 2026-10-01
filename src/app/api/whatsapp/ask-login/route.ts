import { NextResponse } from "next/server";
import { askUserOnlyMessage, resetVendorToAskLogin } from "@/lib/vendor-bot";
import { destroyVendorSession, listVendorSessions } from "@/lib/vendor-session";
import { resolveOwnerJid, sendDirectWhatsApp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Envia o pedido de usuário/senha do CRM no WhatsApp.
 * Body opcional: { phone?: string }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { phone?: string };
    const phone = body.phone?.trim();

    const targets: string[] = [];
    if (phone) {
      targets.push(phone);
    } else {
      const sessions = listVendorSessions();
      const recent = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (recent?.jid) targets.push(recent.jid);
      const owner = resolveOwnerJid();
      if (owner && !targets.includes(owner)) targets.push(owner);
    }

    if (!targets.length) {
      return NextResponse.json(
        { ok: false, error: "Informe um número WhatsApp (DDD+número)." },
        { status: 400 },
      );
    }

    const text = askUserOnlyMessage();
    const sentTo: string[] = [];
    for (const target of Array.from(new Set(targets))) {
      const jid = await sendDirectWhatsApp(target, text);
      await destroyVendorSession(jid, { logout: true }).catch(() => undefined);
      resetVendorToAskLogin(jid);
      sentTo.push(jid);
    }

    return NextResponse.json({ ok: true, sentTo, message: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
