"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SessionUser = {
  id: string;
  name: string;
  username: string;
  role: "master" | "admin" | "vendedor";
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  document?: string;
  email?: string;
  plan?: string;
  city?: string;
  queue: "transferir" | "tratando" | "sem_interesse" | "vendido";
  source: string;
  saleType?: string;
  papId?: string;
  assignedTo?: string | null;
  treatingSince?: string | null;
  saleDate?: string;
  part1?: Record<string, string>;
  part2?: Record<string, string>;
  planData?: Record<string, string>;
};

type Counts = {
  transferir: number;
  tratando: number;
  sem_interesse: number;
  vendido: number;
  staleTreating: number;
  total: number;
};

type Seller = { id: string; name: string; username: string; role: string };

export function MailingPanel() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [boot, setBoot] = useState(true);
  const [username, setUsername] = useState("fabio");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [queue, setQueue] = useState<string>("transferir");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("16/10/2026");
  const [dateTo, setDateTo] = useState("16/10/2026");
  const [saleType, setSaleType] = useState<"interesse" | "venda">("interesse");
  const [papEmail, setPapEmail] = useState("");
  const [papPassword, setPapPassword] = useState("");
  const [scrapeMsg, setScrapeMsg] = useState("");
  const [scrapeLogs, setScrapeLogs] = useState<string[]>([]);
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const [scrapeState, setScrapeState] = useState<string>("idle");
  const [liveShotAt, setLiveShotAt] = useState<string | null>(null);
  const [liveShotLabel, setLiveShotLabel] = useState<string | null>(null);
  const [liveShotUrl, setLiveShotUrl] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLPreElement | null>(null);
  const [manual, setManual] = useState({ name: "", phone: "", document: "", notes: "" });
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    password: "",
    role: "vendedor",
  });
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [pending, startTransition] = useTransition();

  async function refreshMe() {
    const res = await fetch("/api/mailing/me", { cache: "no-store" });
    if (!res.ok) {
      setUser(null);
      return null;
    }
    const data = await res.json();
    setUser(data.user);
    setCounts(data.counts);
    return data.user as SessionUser;
  }

  async function refreshLeads(activeQueue = queue, activeSearch = search) {
    const params = new URLSearchParams({ queue: activeQueue, search: activeSearch });
    const res = await fetch(`/api/mailing/leads?${params}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setLeads(data.leads || []);
    setCounts(data.counts || null);
    setSellers(data.sellers || []);
    if (!sellerId && data.sellers?.[0]?.id) setSellerId(data.sellers[0].id);
  }

  async function refreshUsers() {
    const res = await fetch("/api/mailing/users", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function refreshScrapeDefaults() {
    const res = await fetch("/api/mailing/scrape", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.defaults?.dateFrom) setDateFrom(data.defaults.dateFrom);
    if (data.defaults?.dateTo) setDateTo(data.defaults.dateTo);
    if (data.defaults?.saleType === "venda" || data.defaults?.saleType === "interesse") {
      setSaleType(data.defaults.saleType);
    }
    if (data.papUser) setPapEmail(data.papUser);
    if (data.progress?.message) setScrapeMsg(data.progress.message);
    if (Array.isArray(data.progress?.logs)) setScrapeLogs(data.progress.logs);
    if (data.progress?.state) setScrapeState(data.progress.state);
    if (data.progress?.liveShotAt) {
      setLiveShotAt(data.progress.liveShotAt);
      setLiveShotLabel(data.progress.liveShotLabel || null);
      setLiveShotUrl(`/api/mailing/live-shot?t=${encodeURIComponent(data.progress.liveShotAt)}`);
    }
    if (data.running || data.progress?.state === "running") setScrapeRunning(true);
  }

  useEffect(() => {
    (async () => {
      const u = await refreshMe();
      if (u) {
        await refreshLeads();
        await refreshScrapeDefaults();
        if (u.role === "master" || u.role === "admin") await refreshUsers();
      } else {
        // keep example dates editable as requested
        setDateFrom("16/10/2026");
        setDateTo("16/10/2026");
      }
      setBoot(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll do log ao vivo enquanto a busca PAP estiver rodando
  useEffect(() => {
    if (!user || !scrapeRunning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/mailing/scrape", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (Array.isArray(data.progress?.logs)) setScrapeLogs(data.progress.logs);
        if (data.progress?.message) setScrapeMsg(data.progress.message);
        if (data.progress?.state) setScrapeState(data.progress.state);
        if (data.progress?.liveShotAt) {
          setLiveShotAt(data.progress.liveShotAt);
          setLiveShotLabel(data.progress.liveShotLabel || null);
          setLiveShotUrl(`/api/mailing/live-shot?t=${encodeURIComponent(data.progress.liveShotAt)}`);
        }
        const stillRunning = Boolean(data.running) || data.progress?.state === "running";
        if (!stillRunning) {
          setScrapeRunning(false);
          if (data.progress?.state === "done" || data.progress?.state === "cancelled") {
            setQueue("transferir");
            await refreshLeads("transferir");
          }
        }
      } catch {
        // ignore transient poll errors
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 900);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, scrapeRunning]);

  useEffect(() => {
    const el = logBoxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scrapeLogs]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const res = await fetch("/api/mailing/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoginError(data.error || "Falha no login");
      return;
    }
    setUser(data.user);
    setPassword("");
    await refreshLeads();
    await refreshScrapeDefaults();
    if (data.user.role === "master" || data.user.role === "admin") await refreshUsers();
  }

  async function handleLogout() {
    await fetch("/api/mailing/logout", { method: "POST" });
    setUser(null);
    setLeads([]);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllVisible() {
    setSelected(leads.map((l) => l.id));
  }

  function clearSelection() {
    setSelected([]);
  }

  async function excludeSelected() {
    if (!selected.length) return;
    const ok = window.confirm(
      `Excluir permanentemente ${selected.length} lead(s) selecionado(s)? Essa ação não pode ser desfeita.`,
    );
    if (!ok) return;
    setMessage("");
    const res = await fetch("/api/mailing/leads", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadIds: selected }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || "Falha ao excluir leads.");
      return;
    }
    setMessage(`Excluídos: ${data.removed ?? selected.length}`);
    setSelected([]);
    await refreshLeads();
    await refreshMe();
  }

  async function transfer(ids: string[]) {
    setMessage("");
    const res = await fetch("/api/mailing/transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadIds: ids, sellerId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Falha na transferência");
      return;
    }
    setMessage(`Transferidos: ${data.count}`);
    setSelected([]);
    await refreshLeads();
  }

  async function moveQueue(leadId: string, next: Lead["queue"]) {
    const res = await fetch("/api/mailing/leads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId, queue: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Falha ao mover");
      return;
    }
    await refreshLeads();
  }

  async function runScrape() {
    setScrapeMsg("Iniciando busca humana no PAP…");
    setScrapeLogs([]);
    setScrapeState("running");
    setScrapeRunning(true);
    setMessage("");
    startTransition(async () => {
      const res = await fetch("/api/mailing/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          saleType,
          // Só envia login PAP se parecer e-mail (não misturar com usuário mailing)
          papEmail: papEmail.includes("@") ? papEmail.trim() : undefined,
          papPassword: papPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScrapeRunning(false);
        setScrapeState("error");
        setScrapeMsg(data.error || data.progress?.message || "Erro na busca");
        if (Array.isArray(data.progress?.logs)) setScrapeLogs(data.progress.logs);
        return;
      }
      // 202 Accepted — job em background; o poll atualiza o log ao vivo
      setPapPassword("");
      if (Array.isArray(data.progress?.logs)) setScrapeLogs(data.progress.logs);
      setScrapeMsg(data.progress?.message || "Busca iniciada — acompanhe o log ao vivo.");
      setScrapeRunning(true);
    });
  }

  async function stopScrape() {
    setScrapeMsg("Parando busca…");
    try {
      const res = await fetch("/api/mailing/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (Array.isArray(data.progress?.logs)) setScrapeLogs(data.progress.logs);
      setScrapeMsg(
        data.message ||
          data.progress?.message ||
          "Parada solicitada. Ajuste data/tipo e busque de novo.",
      );
      // Mantém poll até o job marcar cancelled/idle
      setScrapeRunning(true);
    } catch {
      setScrapeMsg("Falha ao solicitar parada.");
    }
  }

  async function uploadExcel(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/mailing/excel", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Falha no Excel");
      return;
    }
    setMessage(`Excel: ${data.imported} importados, ${data.skipped} ignorados`);
    await refreshLeads("transferir");
    setQueue("transferir");
  }

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/mailing/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manual),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Falha no cadastro manual");
      return;
    }
    setManual({ name: "", phone: "", document: "", notes: "" });
    setMessage(`Lead manual: ${data.lead?.name}`);
    await refreshLeads("transferir");
    setQueue("transferir");
  }

  async function createSeller(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/mailing/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newUser),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Falha ao criar usuário");
      return;
    }
    setNewUser({ name: "", username: "", password: "", role: "vendedor" });
    setMessage(`Usuário criado: ${data.user?.username}`);
    await refreshUsers();
    await refreshLeads();
  }

  if (boot) {
    return (
      <div className="mailing-shell flex min-h-screen items-center justify-center">
        <p className="text-white/80">Carregando…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mailing-shell flex min-h-screen items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="mailing-panel w-full max-w-md space-y-5 p-8"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <Image
              src="/logo-one-telecom.jpg"
              alt="ONE TELECOM"
              width={220}
              height={80}
              className="h-auto w-[220px] rounded"
              priority
            />
            <h1 className="mailing-title text-2xl">Mailing One Telecom</h1>
            <p className="text-sm text-white/70">Distribuição de interesses PAP</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="user">Usuário</Label>
            <Input
              id="user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pass">Senha</Label>
            <Input
              id="pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {loginError ? <p className="text-sm text-red-300">{loginError}</p> : null}
          <Button type="submit" className="mailing-cta w-full">
            Entrar
          </Button>
        </form>
      </div>
    );
  }

  const isManager = user.role === "master" || user.role === "admin";

  return (
    <div className="mailing-shell min-h-screen">
      <header className="mailing-header flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
        <div className="flex items-center gap-4">
          <Image
            src="/logo-one-telecom.jpg"
            alt="ONE TELECOM"
            width={160}
            height={56}
            className="h-12 w-auto rounded"
          />
          <div>
            <p className="mailing-title text-lg md:text-xl">Mailing One Telecom</p>
            <p className="text-xs text-white/60">
              {user.name} · {user.role}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Sair
        </Button>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-8">
        {message ? (
          <div className="mailing-panel px-4 py-3 text-sm text-emerald-200">{message}</div>
        ) : null}

        {isManager ? (
          <section className="mailing-panel space-y-4 p-5">
            <h2 className="mailing-title text-lg">Buscar no PAP</h2>
            <p className="text-sm text-white/65">
              Escolha Tipo (Interesse ou Venda) e o período. Em Venda, só entra status{" "}
              <strong className="font-medium text-white/85">Aguardando tratamento</strong> — dados
              saem da lista (sem clicar em Avançar). Interesse segue a regra atual.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="saleType">Tipo</Label>
                <select
                  id="saleType"
                  className="mailing-select"
                  value={saleType}
                  onChange={(e) =>
                    setSaleType(e.target.value === "venda" ? "venda" : "interesse")
                  }
                >
                  <option value="interesse">Interesse</option>
                  <option value="venda">Venda</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Regra do status</Label>
                <p className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                  {saleType === "venda"
                    ? "Só AGUARDANDO TRATAMENTO · sem Avançar/Detalhar"
                    : "Interesse (Minhas Pendências) · regra existente"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateFrom">De (dd/mm/aaaa)</Label>
                <Input
                  id="dateFrom"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  placeholder="16/10/2026"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateTo">Até (dd/mm/aaaa)</Label>
                <Input
                  id="dateTo"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  placeholder="16/10/2026"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="papEmail">Login PAP (opcional)</Label>
                <Input
                  id="papEmail"
                  value={papEmail}
                  onChange={(e) => setPapEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="papPass">Senha PAP (opcional)</Label>
                <Input
                  id="papPass"
                  type="password"
                  value={papPassword}
                  onChange={(e) => setPapPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="mailing-cta"
                disabled={pending || scrapeRunning}
                onClick={runScrape}
              >
                {scrapeRunning ? "Buscando no PAP…" : "Buscar no PAP"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="mailing-stop-btn"
                disabled={pending || !scrapeRunning}
                onClick={stopScrape}
                title={
                  scrapeRunning
                    ? "Interrompe a busca no PAP agora"
                    : "Disponível enquanto a busca estiver rodando"
                }
              >
                Parar busca
              </Button>
              {scrapeRunning ? (
                <span className="self-center text-xs uppercase tracking-wider text-emerald-300">
                  Log ao vivo · {scrapeState} — use Parar se travar no login
                </span>
              ) : null}
            </div>
            {scrapeRunning ? (
              <div className="mailing-stop-bar" role="status">
                <div className="mailing-stop-bar-text">
                  Busca em andamento
                  {scrapeState ? ` · ${scrapeState}` : ""}
                  {liveShotLabel ? ` · ${liveShotLabel}` : ""}
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  className="mailing-stop-btn mailing-stop-btn-lg"
                  disabled={pending}
                  onClick={stopScrape}
                >
                  Parar agora
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-white/50">
              Durante a busca, altere data ou tipo e clique em <strong>Parar busca</strong>{" "}
              para interromper e depois <strong>Buscar no PAP</strong> de novo.
            </p>
            {scrapeMsg ? <p className="text-sm text-sky-200">{scrapeMsg}</p> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>
                    Tela ao vivo do PAP
                    {liveShotLabel ? (
                      <span className="ml-2 font-normal text-white/45">· {liveShotLabel}</span>
                    ) : null}
                  </Label>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="mailing-stop-btn"
                    disabled={pending || !scrapeRunning}
                    onClick={stopScrape}
                  >
                    Parar
                  </Button>
                </div>
                <div className="mailing-live-frame">
                  {scrapeRunning ? (
                    <div className="mailing-live-stop-overlay">
                      <Button
                        type="button"
                        variant="destructive"
                        className="mailing-stop-btn mailing-stop-btn-lg"
                        disabled={pending}
                        onClick={stopScrape}
                      >
                        Parar busca
                      </Button>
                    </div>
                  ) : null}
                  {liveShotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={liveShotAt || liveShotUrl}
                      src={liveShotUrl}
                      alt="Tela ao vivo do browser no PAP"
                      className="mailing-live-img"
                    />
                  ) : (
                    <div className="mailing-live-empty">
                      {scrapeRunning
                        ? "Aguardando primeiro print do browser…"
                        : "Inicie a busca para ver o PAP mexendo aqui."}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Log ao vivo do acesso PAP</Label>
                <pre ref={logBoxRef} className="mailing-log" aria-live="polite">
                  {scrapeLogs.length
                    ? scrapeLogs.join("\n")
                    : "Clique em Buscar no PAP para ver cada passo do login, filtros e importação…"}
                </pre>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["transferir", "Transferir"],
              ["tratando", "Tratando"],
              ["sem_interesse", "Sem interesse"],
              ["vendido", "Vendido"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`mailing-stat ${queue === key ? "active" : ""}`}
              onClick={() => {
                setQueue(key);
                setSelected([]);
                void refreshLeads(key, search);
              }}
            >
              <span className="text-xs uppercase tracking-wider text-white/60">{label}</span>
              <span className="text-2xl font-semibold text-white">
                {counts?.[key] ?? 0}
              </span>
            </button>
          ))}
        </section>

        {isManager ? (
          <section className="mailing-panel space-y-4 p-5">
            <h2 className="mailing-title text-lg">Distribuir mailing</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1 space-y-2">
                <Label>Vendedor</Label>
                <select
                  className="mailing-select"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                >
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.username})
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={!selected.length || !sellerId}
                onClick={() => transfer(selected)}
              >
                Transferir selecionados ({selected.length})
              </Button>
              <Button
                variant="secondary"
                disabled={!leads.length || !sellerId || queue !== "transferir"}
                onClick={() => transfer(leads.map((l) => l.id))}
              >
                Transferir todos da fila
              </Button>
            </div>
          </section>
        ) : null}

        <section className="mailing-panel space-y-4 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="mailing-title text-lg">Leads — {queue}</h2>
            <div className="flex gap-2">
              <Input
                placeholder="Buscar nome/telefone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56"
              />
              <Button
                variant="outline"
                onClick={() => refreshLeads(queue, search)}
              >
                Filtrar
              </Button>
            </div>
          </div>
          {isManager ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!leads.length}
                onClick={selectAllVisible}
              >
                Selecionar todos ({leads.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selected.length}
                onClick={clearSelection}
              >
                Limpar seleção
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!selected.length}
                onClick={() => void excludeSelected()}
              >
                Excluir selecionados ({selected.length})
              </Button>
              <span className="text-xs text-white/50">
                Marque manualmente ou use selecionar todos para remover clientes que não quer mais.
              </span>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="mailing-table w-full text-left text-sm">
              <thead>
                <tr>
                  {isManager ? (
                    <th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={Boolean(leads.length) && selected.length === leads.length}
                        onChange={(e) => {
                          if (e.target.checked) selectAllVisible();
                          else clearSelection();
                        }}
                      />
                    </th>
                  ) : null}
                  <th>Tipo</th>
                  <th>Pedido</th>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Status</th>
                  <th>Plano</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    {isManager ? (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                        />
                      </td>
                    ) : null}
                    <td className="uppercase text-sky-200">
                      {lead.saleType || "interesse"}
                    </td>
                    <td className="font-mono text-xs text-white/90">
                      {lead.part1?.numeroPedido || lead.papId || "—"}
                    </td>
                    <td>
                      <div className="font-medium text-white">{lead.name}</div>
                      {lead.city ? (
                        <div className="text-xs text-white/50">{lead.city}</div>
                      ) : null}
                    </td>
                    <td>{lead.phone}</td>
                    <td>{lead.part1?.status || "—"}</td>
                    <td>{lead.plan || lead.planData?.plano || "—"}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      {user.role === "vendedor" || isManager ? (
                        <>
                          {lead.queue === "tratando" || lead.queue === "transferir" ? (
                            <>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => moveQueue(lead.id, "sem_interesse")}
                              >
                                Sem interesse
                              </Button>
                              <Button
                                size="xs"
                                className="mailing-cta"
                                onClick={() => moveQueue(lead.id, "vendido")}
                              >
                                Vendido
                              </Button>
                            </>
                          ) : null}
                          {lead.queue === "transferir" && user.role === "vendedor" ? (
                            <Button
                              size="xs"
                              onClick={() => moveQueue(lead.id, "tratando")}
                            >
                              Tratar
                            </Button>
                          ) : null}
                          {isManager && lead.queue !== "transferir" ? (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => moveQueue(lead.id, "transferir")}
                            >
                              Voltar fila
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!leads.length ? (
                  <tr>
                    <td
                      colSpan={isManager ? 8 : 7}
                      className="py-8 text-center text-white/50"
                    >
                      Nenhum lead nesta fila.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {isManager ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="mailing-panel space-y-4 p-5">
              <h2 className="mailing-title text-lg">Mailing externo (Excel)</h2>
              <p className="text-sm text-white/65">
                Obrigatório: <strong>nome</strong> e <strong>telefone</strong>. Baixe o modelo.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href="/api/mailing/excel" className="mailing-link-btn">
                  Baixar modelo
                </a>
                <label className="mailing-link-btn cursor-pointer">
                  Enviar Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadExcel(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="mailing-panel space-y-4 p-5">
              <h2 className="mailing-title text-lg">Cadastro manual</h2>
              <form onSubmit={saveManual} className="grid gap-3">
                <Input
                  placeholder="Nome *"
                  value={manual.name}
                  onChange={(e) => setManual({ ...manual, name: e.target.value })}
                  required
                />
                <Input
                  placeholder="Telefone *"
                  value={manual.phone}
                  onChange={(e) => setManual({ ...manual, phone: e.target.value })}
                  required
                />
                <Input
                  placeholder="CPF (opcional)"
                  value={manual.document}
                  onChange={(e) => setManual({ ...manual, document: e.target.value })}
                />
                <Textarea
                  placeholder="Observações"
                  value={manual.notes}
                  onChange={(e) => setManual({ ...manual, notes: e.target.value })}
                />
                <Button type="submit" className="mailing-cta">
                  Adicionar à fila transferir
                </Button>
              </form>
            </section>

            <section className="mailing-panel space-y-4 p-5 lg:col-span-2">
              <h2 className="mailing-title text-lg">Usuários</h2>
              <form
                onSubmit={createSeller}
                className="grid gap-3 md:grid-cols-5"
              >
                <Input
                  placeholder="Nome"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  required
                />
                <Input
                  placeholder="Login"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  required
                />
                <Input
                  placeholder="Senha"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                />
                <select
                  className="mailing-select"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="vendedor">Vendedor</option>
                  <option value="admin">Administrador</option>
                </select>
                <Button type="submit">Criar</Button>
              </form>
              <div className="overflow-x-auto">
                <table className="mailing-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Login</th>
                      <th>Perfil</th>
                      <th>Ativo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={String(u.id)}>
                        <td>{String(u.name)}</td>
                        <td>{String(u.username)}</td>
                        <td>{String(u.role)}</td>
                        <td>{u.active ? "sim" : "não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
