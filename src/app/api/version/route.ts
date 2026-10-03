import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Endpoint só para conferir se o deploy do Railway pegou o código novo. */
export async function GET() {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.BUILD_SHA ||
    "local";
  return NextResponse.json({
    ok: true,
    gitSha: sha,
    shortSha: sha.slice(0, 12),
    buildId: "venda8-fila-async-20261003",
    robotWhatsapp: "48996450101",
    bkoWhatsapp: "47997860234",
    vendorBotOnlyOnCrm: true,
    appMode: process.env.APP_MODE || "bko",
    faturaOpcao6: true,
    vendaOpcao8: true,
    askCpfOnOption6: true,
    askCpfOnOption8: true,
    noEmBreve: true,
    replySameChat: true,
    timezone: "America/Sao_Paulo",
    redeployBump: "venda8-20261001",
    builtAt: new Date().toISOString(),
  });
}
