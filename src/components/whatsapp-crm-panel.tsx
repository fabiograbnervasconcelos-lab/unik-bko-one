"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type VendorSession = {
  jid: string;
  phase: string;
  crmUser: string | null;
  busy: boolean;
};

type StatusPayload = {
  whatsapp?: "disconnected" | "connecting" | "qr" | "connected" | "error";
  hasQr?: boolean;
  whatsappError?: string | null;
  step?: string;
  vendorBot?: {
    loggedIn: number;
    sessions: VendorSession[];
  };
  deploy?: {
    gitSha?: string;
    faturaOpcao6?: boolean;
    timezone?: string;
  };
  logs?: { ts: string; level: string; message: string }[];
};

function waLabel(state: StatusPayload["whatsapp"]) {
  if (state === "connected") return "Conectado";
  if (state === "qr") return "Escaneie o QR";
  if (state === "connecting") return "Conectando";
  if (state === "error") return "Erro";
  return "Desconectado";
}

export function WhatsAppCrmPanel() {
  const [snapshot, setSnapshot] = useState<StatusPayload | null>(null);
  const [qrTick, setQrTick] = useState(0);
  const [qrFailed, setQrFailed] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/status", { cache: "no-store" });
    const data = (await response.json()) as StatusPayload;
    setSnapshot(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/whatsapp/connect", { method: "POST" })
      .then(() => {
        if (!cancelled) {
          setQrTick((value) => value + 1);
          return refresh();
        }
      })
      .catch(() => undefined);
    const statusId = window.setInterval(() => {
      void refresh();
    }, 1500);
    const qrId = window.setInterval(() => {
      setQrTick((value) => value + 1);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(statusId);
      window.clearInterval(qrId);
    };
  }, [refresh]);

  async function refreshQr() {
    setRefreshingQr(true);
    setNotice(null);
    try {
      const response = await fetch("/api/whatsapp/qr-refresh", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não gerou o QR.");
      setQrFailed(false);
      setQrTick((value) => value + 1);
      setNotice("QR novo gerado. Escaneie com o celular do robô (48 99645-0101).");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingQr(false);
    }
  }

  const connected = snapshot?.whatsapp === "connected";
  const sessions = snapshot?.vendorBot?.sessions ?? [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400 uppercase">
          Unik Telecom · Robô WhatsApp
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">WhatsApp CRM NIO</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          App separado do painel CRM × GED. Conecte o WhatsApp do robô{" "}
          <strong>48 99645-0101</strong>. Cada vendedor que mandar mensagem recebe resposta no
          próprio chat (login CRM, menu 1–7, faturas).
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant={connected ? "default" : "secondary"}>
            WhatsApp: {waLabel(snapshot?.whatsapp)}
          </Badge>
          <Badge variant="outline">
            Vendedores logados: {snapshot?.vendorBot?.loggedIn ?? 0}
          </Badge>
          {snapshot?.deploy?.faturaOpcao6 ? (
            <Badge variant="outline">fatura opção 6</Badge>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          {notice}
        </div>
      ) : null}

      <section className="rounded-2xl border border-border/70 bg-card/40 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">1. Conectar WhatsApp do robô</h2>
            <p className="text-sm text-muted-foreground">
              No celular <strong>48 99645-0101</strong>: WhatsApp → Aparelhos conectados → Conectar
              um aparelho.
            </p>
          </div>
          <Button variant="outline" disabled={refreshingQr} onClick={() => void refreshQr()}>
            {refreshingQr ? "Gerando…" : "Gerar outro QR"}
          </Button>
        </div>

        <div className="flex min-h-[320px] items-center justify-center rounded-xl bg-white p-4">
          {connected ? (
            <div className="space-y-2 text-center text-zinc-800">
              <p className="text-lg font-semibold">Sessão ativa</p>
              <p className="text-sm">
                Robô pronto. Qualquer número que mandar mensagem para o 48 99645-0101 será
                atendido no próprio chat.
              </p>
            </div>
          ) : qrFailed ? (
            <p className="text-sm text-zinc-600">QR indisponível. Clique em Gerar outro QR.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={qrTick}
              src={`/api/whatsapp/qr?t=${qrTick}`}
              alt="QR Code WhatsApp do robô CRM"
              className="h-[280px] w-[280px]"
              onError={() => setQrFailed(true)}
              onLoad={() => setQrFailed(false)}
            />
          )}
        </div>
        {snapshot?.whatsappError ? (
          <p className="mt-3 text-sm text-red-400">{snapshot.whatsappError}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/40 p-5">
        <h2 className="text-lg font-medium">2. Menu do vendedor</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O vendedor manda qualquer mensagem → informa usuário/senha do CRM → menu NIO (1–5
          consultas, 6 faturas, 7 encerrar).
        </p>
        {sessions.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {sessions.map((session) => (
              <li
                key={session.jid}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
              >
                <span className="font-mono text-xs">{session.jid}</span>
                <span>
                  {session.crmUser ? `CRM: ${session.crmUser}` : "aguardando login"} ·{" "}
                  {session.phase}
                  {session.busy ? " · ocupado" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum vendedor ativo no momento.</p>
        )}
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/40 p-5">
        <h2 className="mb-3 text-lg font-medium">Log</h2>
        <div className="max-h-64 space-y-1 overflow-auto font-mono text-[11px] leading-5">
          {[...(snapshot?.logs ?? [])].reverse().slice(0, 40).map((line) => (
            <div key={`${line.ts}-${line.message}`} className="grid grid-cols-[72px_1fr] gap-2">
              <span className="text-muted-foreground">
                {new Date(line.ts).toLocaleTimeString("pt-BR")}
              </span>
              <span
                className={
                  line.level === "error"
                    ? "text-red-400"
                    : line.level === "warn"
                      ? "text-amber-300"
                      : "text-emerald-200/80"
                }
              >
                {line.message}
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        Painel CRM × GED continua em{" "}
        <a
          className="underline"
          href="https://unik-bko-one-production.up.railway.app/"
          target="_blank"
          rel="noreferrer"
        >
          unik-bko-one-production
        </a>
        .
      </p>
    </main>
  );
}
