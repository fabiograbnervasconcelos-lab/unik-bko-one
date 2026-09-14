import { NextResponse } from "next/server";
import { getSnapshot, log, requestStop, setJob } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  requestStop();
  if (getSnapshot().job === "running") {
    setJob("error", { error: "Envio interrompido.", step: "Parado: nenhum WhatsApp a mais será enviado." });
  }
  log("warn", "Pedido para parar o envio.");
  return NextResponse.json(getSnapshot());
}
