import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.BUILD_SHA ||
    "local";
  return cors(
    NextResponse.json({
      ok: true,
      ts: Date.now(),
      gitSha: sha.slice(0, 12),
      features: {
        vendorBot: true,
        faturaOpcao6: true,
        faturaRoboUrl:
          process.env.FATURA_ROBO_URL ||
          "https://robo-one-telecom-production.up.railway.app",
      },
    }),
  );
}
