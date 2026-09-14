"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { AppSnapshot, LeadResult, LogLine, WhatsAppGroup } from "@/lib/store";
import type { AppSettings } from "@/lib/settings";
import { GED_ANALYSIS_STATUSES } from "@/lib/text";

type StatusPayload = AppSnapshot & { settings: AppSettings; hasQr?: boolean };

const EMPTY_SETTINGS: AppSettings = {
  crmUser: "",
  crmPass: "",
  gedUser: "",
  gedPass: "",
  gedDomain: "1",
  groupBko: "bko one urgente",
  groupGerentes: "gerentes one",
  extraCpfs: "",
};

function waLabel(state: AppSnapshot["whatsapp"]) {
  if (state === "connected") return "Conectado";
  if (state === "qr") return "Escaneie o QR";
  if (state === "connecting") return "Conectando";
  if (state === "error") return "Erro";
  return "Desconectado";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function LogRow({ line }: { line: LogLine }) {
  const color =
    line.level === "error"
      ? "text-red-400"
      : line.level === "warn"
        ? "text-amber-300"
        : "text-emerald-200/80";
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2 font-mono text-[11px] leading-5">
      <span className="text-muted-foreground">{formatTime(line.ts)}</span>
      <span className={color}>{line.message}</span>
    </div>
  );
}

function ResultRow({ row }: { row: LeadResult }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.cpf}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{row.crmStatus}</Badge>
          {row.gedResult ? (
            <Badge>{row.gedResult}</Badge>
          ) : (
            <Badge variant="secondary">
              {row.hasDigitization ? "Sem status alvo" : "Sem digitalização"}
            </Badge>
          )}
          {row.notified ? <Badge variant="outline">WhatsApp enviado</Badge> : null}
        </div>
      </div>
      {row.error ? <p className="mt-2 text-xs text-red-400">{row.error}</p> : null}
      {row.notifyTargets.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Grupos: {row.notifyTargets.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrTick, setQrTick] = useState(0);
  const [qrFailed, setQrFailed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function readForm(): AppSettings {
    const form = formRef.current;
    if (!form) return EMPTY_SETTINGS;
    const data = new FormData(form);
    return {
      crmUser: String(data.get("crmUser") ?? "").trim(),
      crmPass: String(data.get("crmPass") ?? ""),
      gedUser: String(data.get("gedUser") ?? "").trim(),
      gedPass: String(data.get("gedPass") ?? ""),
      gedDomain: data.get("gedDomain") === "2" ? "2" : "1",
      groupBko: String(data.get("groupBko") ?? "bko one urgente"),
      groupGerentes: String(data.get("groupGerentes") ?? "gerentes one"),
      extraCpfs: String(data.get("extraCpfs") ?? ""),
    };
  }

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
    }, 1200);
    const qrId = window.setInterval(() => {
      setQrTick((value) => value + 1);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(statusId);
      window.clearInterval(qrId);
    };
  }, [refresh]);

  async function saveSettings() {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readForm()),
      });
      if (!response.ok) throw new Error("Não foi possível salvar.");
      setNotice("Credenciais salvas neste servidor.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setNotice(null);
    await saveSettings();
    try {
      const response = await fetch("/api/run", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na verificação.");
      setNotice(data.step || "Verificação concluída.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      void refresh();
    }
  }

  async function testWhatsApp() {
    setTesting(true);
    setNotice(null);
    await saveSettings();
    try {
      const response = await fetch("/api/whatsapp/test", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha no teste.");
      setNotice(`Teste enviado para: ${(data.sent ?? []).join(", ")}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
      void refresh();
    }
  }

  const groups: WhatsAppGroup[] = snapshot?.groups ?? [];
  const logs = useMemo(() => [...(snapshot?.logs ?? [])].reverse(), [snapshot?.logs]);
  const connected = snapshot?.whatsapp === "connected";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-amber-400 uppercase">
            Unik Telecom · BKO One
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Alerta de digitalização
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Lê no CRM quem está em <strong>cancelado/bio expirada</strong> ou{" "}
            <strong>aguardando biometria</strong>, consulta o CPF no GED360 e avisa os
            grupos <strong>BKO One Urgente</strong> e <strong>Gerentes One</strong> se a
            análise estiver em um dos status alvo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"}>
            WhatsApp: {waLabel(snapshot?.whatsapp ?? "disconnected")}
          </Badge>
          <Badge variant="outline">{snapshot?.step ?? "Carregando painel..."}</Badge>
        </div>
      </header>

      {notice ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(280px,380px)_1fr]">
        <Card className="border-amber-400/20">
          <CardHeader>
            <CardTitle>1. WhatsApp — leia o QR aqui</CardTitle>
            <CardDescription>
              No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR
              atualiza sozinho.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex min-h-[300px] items-center justify-center rounded-xl bg-white p-4">
              {connected ? (
                <div className="space-y-2 text-center text-zinc-800">
                  <p className="text-lg font-semibold">Sessão ativa</p>
                  <p className="text-sm">Pode rodar a verificação. Não precisa escanear de novo.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {/* Native img so the QR loads even before React state updates. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/whatsapp/qr?t=${qrTick}`}
                    alt="QR Code do WhatsApp"
                    width={280}
                    height={280}
                    className={qrFailed ? "hidden" : "h-[280px] w-[280px] bg-white"}
                    onLoad={() => setQrFailed(false)}
                    onError={() => setQrFailed(true)}
                  />
                  {qrFailed ? (
                    <p className="text-center text-sm text-zinc-600">
                      {snapshot?.whatsappError || "Gerando QR Code... aguarde uns segundos."}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Grupos encontrados</p>
              {groups.length ? (
                <ul className="space-y-1 text-sm">
                  {groups.map((group) => (
                    <li key={group.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{group.name}</span>
                      {group.matched ? (
                        <Badge variant="outline">
                          {group.matched === "bko" ? "BKO urgente" : "Gerentes"}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Depois do QR, os grupos da conta aparecem aqui. Precisa achar{" "}
                  <em>bko one urgente</em> e <em>gerentes one</em>.
                </p>
              )}
            </div>
            <Button variant="outline" disabled={!connected || testing} onClick={() => void testWhatsApp()}>
              {testing ? "Enviando teste..." : "Enviar mensagem de teste"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Acessos do CRM e do GED360</CardTitle>
            <CardDescription>
              A senha fica visível de propósito neste painel, para o navegador não bloquear
              o campo. Salva só neste servidor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form ref={formRef} className="relative z-20 grid gap-4 md:grid-cols-2" autoComplete="off" onSubmit={(event) => event.preventDefault()}>
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                CRM Unik · proadmin
              </p>
              <div className="space-y-1">
                <Label htmlFor="crmUser">Usuário</Label>
                <input
                  id="crmUser"
                  name="crmUser"
                  type="text"
                  className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="crmPass">Senha do CRM</Label>
                <input
                  id="crmPass"
                  name="crmPass"
                  type="text"
                  className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Digite a senha aqui"
                />
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                GED360 · BrProntoPDV
              </p>
              <div className="space-y-1">
                <Label htmlFor="gedUser">Login</Label>
                <input
                  id="gedUser"
                  name="gedUser"
                  type="text"
                  className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gedPass">Senha do GED</Label>
                <input
                  id="gedPass"
                  name="gedPass"
                  type="text"
                  className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Digite a senha aqui"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gedDomain">Domínio</Label>
                <select
                  id="gedDomain"
                  name="gedDomain"
                  className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-sm text-zinc-900"
                  defaultValue="1"
                >
                  <option value="1">BrPronto</option>
                  <option value="2">NDS</option>
                </select>
              </div>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="groupBko">Nome do grupo BKO</Label>
              <input
                id="groupBko"
                name="groupBko"
                type="text"
                defaultValue="bko one urgente"
                className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="groupGerentes">Nome do grupo gerentes</Label>
              <input
                id="groupGerentes"
                name="groupGerentes"
                type="text"
                defaultValue="gerentes one"
                className="h-11 w-full rounded-md border border-zinc-500 bg-white px-3 text-base text-zinc-900"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="extraCpfs">CPFs extras (opcional, um por linha)</Label>
              <textarea
                id="extraCpfs"
                name="extraCpfs"
                rows={3}
                placeholder="Use só para testar um CPF fora do CRM"
                className="w-full rounded-md border border-zinc-500 bg-white px-3 py-2 text-base text-zinc-900"
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => void saveSettings()}>
                {saving ? "Salvando..." : "Salvar acessos"}
              </Button>
              <Button type="button" disabled={running || !connected} onClick={() => void runNow()}>
                {running ? "Verificando..." : "Rodar verificação agora"}
              </Button>
            </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Resultados</CardTitle>
            <CardDescription>
              Alerta só se abrir a tela de digitalização e o Resultado da Análise for um
              destes: {GED_ANALYSIS_STATUSES.join(" · ")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot?.results.length ? (
              <div className="space-y-2">
                {snapshot.results.map((row) => (
                  <ResultRow key={`${row.cpf}-${row.crmStatus}`} row={row} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ainda não rodou. Conecte o WhatsApp, grave os logins e clique em verificar.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Log ao vivo</CardTitle>
            <CardDescription>CRM, cookies do GED, busca unitária e envio.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[360px] rounded-lg border bg-black/40 p-3">
              {logs.length ? (
                logs.map((line, index) => <LogRow key={`${line.ts}-${index}`} line={line} />)
              ) : (
                <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Prints do robô</CardTitle>
            <CardDescription>
              Use para conferir se o login, o filtro do CRM e a busca unitária abriram a
              tela certa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot?.screenshots.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {snapshot.screenshots.map((file) => (
                  <figure key={file} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/screenshots/${file}?t=${snapshot.updatedAt}`}
                      alt={file}
                      className="aspect-video w-full rounded-lg border object-cover bg-muted"
                    />
                    <figcaption className="truncate text-xs text-muted-foreground">{file}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Os prints aparecem depois da primeira rodada.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Separator />
      <p className="pb-4 text-xs text-muted-foreground">
        O WhatsApp entra como aparelho vinculado por QR. Se o celular desconectar, um QR
        novo aparece nesta página.
      </p>
    </main>
  );
}
