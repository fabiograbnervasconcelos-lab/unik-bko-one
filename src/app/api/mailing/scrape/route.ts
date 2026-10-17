import { NextResponse } from "next/server";
import { canScrapePap, getSessionUser } from "@/lib/mailing/auth";
import {
  loadPapCredentials,
  loadScrapeProgress,
  savePapCredentials,
} from "@/lib/mailing/store";
import {
  normalizeSaleType,
  runPapHistoricoScrape,
  type PapSaleType,
} from "@/lib/mailing/pap-scraper";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Período padrão do histório (editável na UI). */
const DEFAULT_DATE_FROM = "16/10/2026";
const DEFAULT_DATE_TO = "16/10/2026";
const DEFAULT_SALE_TYPE: PapSaleType = "interesse";

let scrapeRunning = false;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const progress = loadScrapeProgress();
  const creds = loadPapCredentials();
  return NextResponse.json({
    progress,
    running: scrapeRunning,
    defaults: {
      dateFrom: progress.dateFrom || DEFAULT_DATE_FROM,
      dateTo: progress.dateTo || DEFAULT_DATE_TO,
      saleType: normalizeSaleType(progress.saleType || DEFAULT_SALE_TYPE),
    },
    papUser: creds.email,
    hasPapPass: Boolean(creds.password),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canScrapePap(user.role)) {
    return NextResponse.json({ error: "Sem permissão para buscar no PAP." }, { status: 403 });
  }
  if (scrapeRunning) {
    return NextResponse.json({ error: "Já existe uma busca em andamento." }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as {
    dateFrom?: string;
    dateTo?: string;
    saleType?: string;
    papEmail?: string;
    papPassword?: string;
  } | null;

  const dateFrom = (body?.dateFrom || DEFAULT_DATE_FROM).trim();
  const dateTo = (body?.dateTo || DEFAULT_DATE_TO).trim();
  const saleType = normalizeSaleType(body?.saleType || DEFAULT_SALE_TYPE);

  if (body?.papEmail || body?.papPassword) {
    const current = loadPapCredentials();
    savePapCredentials({
      email: (body.papEmail || current.email).trim(),
      password: body.papPassword || current.password,
    });
  }

  scrapeRunning = true;
  try {
    // Fire and wait — mailing scrape can take minutes; client polls GET
    const result = await runPapHistoricoScrape({ dateFrom, dateTo, saleType });
    return NextResponse.json({ ok: true, result, progress: loadScrapeProgress() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        progress: loadScrapeProgress(),
      },
      { status: 500 },
    );
  } finally {
    scrapeRunning = false;
  }
}
