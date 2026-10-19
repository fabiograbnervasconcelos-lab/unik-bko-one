import { NextResponse } from "next/server";
import { canScrapePap, getSessionUser } from "@/lib/mailing/auth";
import {
  loadPapCredentials,
  loadScrapeProgress,
  savePapCredentials,
} from "@/lib/mailing/store";
import {
  normalizeSaleType,
  requestCancelScrape,
  runPapHistoricoScrape,
  type PapSaleType,
} from "@/lib/mailing/pap-scraper";

export const dynamic = "force-dynamic";
/** Scrape longo (centenas de páginas) roda em background após 202. */
export const maxDuration = 3600;

/** Período padrão do histório (editável na UI). */
const DEFAULT_DATE_FROM = "16/10/2026";
const DEFAULT_DATE_TO = "16/10/2026";
const DEFAULT_SALE_TYPE: PapSaleType = "interesse";

const globalScrape = globalThis as typeof globalThis & {
  mailingScrapeRunning?: boolean;
};

function isScrapeRunning() {
  return Boolean(globalScrape.mailingScrapeRunning);
}

function setScrapeRunning(value: boolean) {
  globalScrape.mailingScrapeRunning = value;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const progress = loadScrapeProgress();
  const creds = loadPapCredentials();
  return NextResponse.json({
    progress,
    running: isScrapeRunning() || progress.state === "running",
    defaults: {
      dateFrom: progress.dateFrom || DEFAULT_DATE_FROM,
      dateTo: progress.dateTo || DEFAULT_DATE_TO,
      saleType: normalizeSaleType(progress.saleType || DEFAULT_SALE_TYPE),
    },
    papUser: creds.email,
    hasPapPass: Boolean(creds.password),
  });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canScrapePap(user.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (!isScrapeRunning() && loadScrapeProgress().state !== "running") {
    return NextResponse.json({
      ok: true,
      stopped: false,
      message: "Nenhuma busca em andamento.",
      progress: loadScrapeProgress(),
    });
  }
  requestCancelScrape();
  return NextResponse.json({
    ok: true,
    stopped: true,
    message: "Parada solicitada — aguarde o browser fechar.",
    progress: loadScrapeProgress(),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canScrapePap(user.role)) {
    return NextResponse.json({ error: "Sem permissão para buscar no PAP." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    saleType?: string;
    papEmail?: string;
    papPassword?: string;
  } | null;

  // Parar busca em andamento (também via POST action=stop)
  if (body?.action === "stop" || body?.action === "cancel") {
    if (!isScrapeRunning() && loadScrapeProgress().state !== "running") {
      return NextResponse.json({
        ok: true,
        stopped: false,
        message: "Nenhuma busca em andamento.",
        progress: loadScrapeProgress(),
      });
    }
    requestCancelScrape();
    return NextResponse.json({
      ok: true,
      stopped: true,
      message: "Parada solicitada — aguarde o browser fechar.",
      progress: loadScrapeProgress(),
    });
  }

  if (isScrapeRunning()) {
    return NextResponse.json({ error: "Já existe uma busca em andamento. Clique em Parar antes." }, { status: 409 });
  }

  const dateFrom = (body?.dateFrom || DEFAULT_DATE_FROM).trim();
  const dateTo = (body?.dateTo || DEFAULT_DATE_TO).trim();
  const saleType = normalizeSaleType(body?.saleType || DEFAULT_SALE_TYPE);

  if (body?.papEmail || body?.papPassword) {
    const current = loadPapCredentials();
    const nextEmail = (body.papEmail || current.email).trim();
    // Ignora valor que não é e-mail (ex.: usuário do mailing "fabio")
    if (nextEmail.includes("@")) {
      try {
        savePapCredentials({
          email: nextEmail,
          password: body.papPassword || current.password,
        });
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 },
        );
      }
    }
  }

  setScrapeRunning(true);

  // Roda em background para o cliente poder fazer poll do log ao vivo (GET).
  void (async () => {
    try {
      await runPapHistoricoScrape({ dateFrom, dateTo, saleType });
    } catch {
      // Erro já gravado em scrape-progress.logs
    } finally {
      setScrapeRunning(false);
    }
  })();

  return NextResponse.json(
    {
      ok: true,
      started: true,
      progress: loadScrapeProgress(),
    },
    { status: 202 },
  );
}
