import { NextResponse } from "next/server";
import { log } from "@/lib/store";
import { regenerateWhatsAppQr } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Encerra a sessão atual, apaga credenciais e gera um QR novo. */
export async function POST() {
  try {
    log("info", "Gerando novo QR do WhatsApp...");
    const snapshot = await regenerateWhatsAppQr();
    return NextResponse.json({
      ok: true,
      whatsapp: snapshot.whatsapp,
      hasQr: Boolean(snapshot.qrDataUrl),
      step: snapshot.step,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Falha ao regenerar QR: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
