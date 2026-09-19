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
    faturaOpcao6: true,
    askCpfOnOption6: true,
    debugFatura: true,
    timezone: "America/Sao_Paulo",
    builtAt: new Date().toISOString(),
  });
}
