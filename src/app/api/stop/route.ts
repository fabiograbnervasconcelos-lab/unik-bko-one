import { NextResponse } from "next/server";
import { getSnapshot, log, requestStop } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  requestStop();
  log("warn", "Pedido para parar a consulta/envio.");
  return NextResponse.json(getSnapshot());
}
