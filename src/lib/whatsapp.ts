import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { defaultOwnerJid, isOwnerDirectChat, ownerDigits } from "@/lib/owner";
import { DATA_DIR, ensureDataDirs, WHATSAPP_AUTH_DIR } from "@/lib/paths";
import { loadSettings } from "@/lib/settings";
import { getSnapshot, log, setOwnerJid, setWhatsAppState } from "@/lib/store";
import { isValidateAndSendCommand, onlyDigits, scoreGroupName } from "@/lib/text";
import {
  acquireWhatsAppSessionLock,
  authFilesPresent,
  hasRegisteredWhatsAppAuth,
  releaseWhatsAppSessionLock,
  touchWhatsAppSessionLock,
} from "@/lib/whatsapp-session-lock";

const logger = pino({ level: "silent" });
const QR_PNG_PATH = path.join(DATA_DIR, "whatsapp-qr.png");
const OWNER_JID_PATH = path.join(DATA_DIR, "owner-jid.txt");
const KEEPALIVE_MS = 4 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 20_000;

export type WhatsAppTarget = "bko" | "gerentes" | "owner";

type WhatsAppRuntime = {
  socket: WASocket | null;
  connecting: boolean;
  shouldReconnect: boolean;
  qrPng: Buffer | null;
  lastCommandAt: number;
  reconnectAttempt: number;
  keepaliveTimer?: ReturnType<typeof setInterval>;
  lockTimer?: ReturnType<typeof setInterval>;
  shuttingDown: boolean;
  signalsBound: boolean;
};

const globalForWa = globalThis as typeof globalThis & {
  unikBkoWhatsApp?: WhatsAppRuntime;
};

const runtime: WhatsAppRuntime = globalForWa.unikBkoWhatsApp ?? {
  socket: null,
  connecting: false,
  shouldReconnect: true,
  qrPng: null,
  lastCommandAt: 0,
  reconnectAttempt: 0,
  shuttingDown: false,
  signalsBound: false,
};

globalForWa.unikBkoWhatsApp = runtime;

function pickGroup(
  groups: { id: string; name: string }[],
  needles: string[],
) {
  const ranked = groups
    .map((group) => ({ ...group, score: scoreGroupName(group.name, needles) }))
    .filter((group) => group.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

function waitUntil(timeoutMs: number, check: () => boolean) {
  return new Promise<void>((resolve) => {
    if (check()) {
      resolve();
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (check() || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 150);
  });
}

function persistOwnerJid(jid: string) {
  ensureDataDirs();
  fs.writeFileSync(OWNER_JID_PATH, jid);
  setOwnerJid(jid);
}

export function resolveOwnerJid() {
  if (getSnapshot().ownerJid) return getSnapshot().ownerJid!;
  if (fs.existsSync(OWNER_JID_PATH)) {
    const saved = fs.readFileSync(OWNER_JID_PATH, "utf8").trim();
    if (saved) {
      setOwnerJid(saved);
      return saved;
    }
  }
  return defaultOwnerJid();
}

function isIgnorableChatJid(jid: string) {
  return (
    jid.endsWith("@g.us") ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter") ||
    jid === "status@broadcast"
  );
}

/** Preferência: responder no JID em que a mensagem chegou; sessão CRM unifica LID+telefone. */
function chatRouting(message: WAMessage) {
  const remoteJid = message.key.remoteJid || "";
  const alt = message.key.remoteJidAlt || undefined;
  const candidates = [remoteJid, alt].filter(Boolean) as string[];
  const phoneJid = candidates.find((jid) => jid.endsWith("@s.whatsapp.net"));
  const lidJid = candidates.find((jid) => jid.endsWith("@lid"));
  return {
    replyJid: remoteJid,
    sessionJid: phoneJid || remoteJid,
    phoneJid: phoneJid || null,
    lidJid: lidJid || null,
  };
}

function incomingText(message: WAMessage) {
  const content = message.message;
  if (!content) return "";
  const inner =
    content.ephemeralMessage?.message ||
    content.viewOnceMessage?.message ||
    content;

  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.templateButtonReplyMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
    ""
  ).trim();
}

async function replyText(remoteJid: string, text: string) {
  if (!runtime.socket || !text || !remoteJid) return;
  try {
    await runtime.socket.sendMessage(remoteJid, { text });
    log("info", `Resposta WhatsApp enviada para ${remoteJid}.`);
  } catch (error) {
    log("warn", `Falha ao responder WhatsApp (${remoteJid}): ${String(error)}`);
  }
}

async function replyPdf(
  remoteJid: string,
  data: Buffer,
  fileName: string,
  caption?: string,
) {
  if (!runtime.socket) return;
  await runtime.socket
    .sendMessage(remoteJid, {
      document: data,
      mimetype: "application/pdf",
      fileName,
      caption,
    })
    .catch((error) => {
      log("warn", `Falha ao enviar PDF WhatsApp (${remoteJid}): ${String(error)}`);
    });
}

async function handleIncomingCommand(message: WAMessage) {
  if (message.key.fromMe) return;
  const remoteJid = message.key.remoteJid;
  if (!remoteJid) return;
  // Só conversa 1:1 — ignora grupos, broadcast e canais/newsletter
  if (isIgnorableChatJid(remoteJid)) return;

  const text = incomingText(message);
  if (!text) {
    log(
      "info",
      `WhatsApp DM sem texto útil de ${remoteJid}` +
        (message.key.remoteJidAlt ? ` (alt ${message.key.remoteJidAlt})` : "") +
        ` keys=${message.message ? Object.keys(message.message).join(",") : "none"}`,
    );
    return;
  }

  const { replyJid, sessionJid, phoneJid, lidJid } = chatRouting(message);
  if (phoneJid && lidJid) {
    const { linkVendorJids } = await import("@/lib/vendor-session");
    linkVendorJids(phoneJid, lidJid);
  }

  // Owner: mantém o comando BKO "validar e enviar"
  if (
    (isOwnerDirectChat(replyJid, message.key.participant) ||
      (phoneJid && isOwnerDirectChat(phoneJid, message.key.participant))) &&
    isValidateAndSendCommand(text)
  ) {
    persistOwnerJid(phoneJid || replyJid);
    if (Date.now() - runtime.lastCommandAt < 8000) {
      log("info", "Comando WhatsApp ignorado: já está rodando um validar e enviar.");
      return;
    }
    runtime.lastCommandAt = Date.now();
    log("info", `Comando WhatsApp recebido de ${replyJid}: ${text}`);
    await replyText(
      replyJid,
      "Unik BKO: recebi *validar e enviar*. Vou consultar e mandar o que estiver na fila.",
    );
    const { startValidateAndSendFromWhatsApp } = await import("@/lib/pipeline");
    try {
      startValidateAndSendFromWhatsApp();
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      log("error", `Comando validar e enviar falhou: ${err}`);
      await replyText(replyJid, `Unik BKO: não consegui executar. ${err}`);
    }
    return;
  }

  // Vendedores (e o dono, se não for o comando BKO): fluxo CRM por WhatsApp
  if (process.env.DISABLE_VENDOR_BOT === "1") {
    return;
  }
  log(
    "info",
    `Mensagem vendedor de ${replyJid}` +
      (sessionJid !== replyJid ? ` [sessão ${sessionJid}]` : "") +
      ` (${text.length} chars)`,
  );
  try {
    const { handleVendorMessage } = await import("@/lib/vendor-bot");
    const replies = await handleVendorMessage(sessionJid, text);
    for (const reply of replies) {
      if (reply.kind === "text") {
        await replyText(replyJid, reply.text);
      } else if (reply.kind === "pdf") {
        await replyPdf(replyJid, reply.data, reply.fileName, reply.caption);
      }
    }
  } catch (error) {
    log("error", `Bot vendedor falhou: ${String(error)}`);
    await replyText(
      replyJid,
      "❌ Deu erro interno. Pode tentar novamente em instantes?",
    );
  }
}

async function saveQr(qr: string) {
  const png = await QRCode.toBuffer(qr, {
    type: "png",
    margin: 2,
    width: 480,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#ffffff" },
  });
  runtime.qrPng = png;
  ensureDataDirs();
  fs.writeFileSync(QR_PNG_PATH, png);
  const qrDataUrl = `data:image/png;base64,${png.toString("base64")}`;
  setWhatsAppState("qr", { qrDataUrl, whatsappError: null });
  log("info", "QR Code gerado. Abra o WhatsApp → Aparelhos conectados → Conectar.");
}

async function refreshGroups() {
  if (!runtime.socket) return [];
  const participating = await runtime.socket.groupFetchAllParticipating();
  const settings = loadSettings();
  const groups = Object.values(participating).map((group) => ({
    id: group.id,
    name: group.subject || group.id,
  }));
  const bko = pickGroup(groups, settings.groupBko.split(" "));
  const gerentes = pickGroup(
    groups,
    settings.groupGerentes.split(" ").filter(Boolean),
  );
  const mapped = groups.map((group) => ({
    ...group,
    matched:
      group.id === bko?.id ? ("bko" as const) : group.id === gerentes?.id ? ("gerentes" as const) : null,
  }));
  setWhatsAppState("connected", { groups: mapped, qrDataUrl: null, whatsappError: null });
  if (bko) log("info", `Grupo BKO encontrado: ${bko.name}`);
  else log("warn", `Nenhum grupo bateu com "${settings.groupBko}".`);
  if (gerentes) log("info", `Grupo gerentes encontrado: ${gerentes.name}`);
  else log("warn", `Nenhum grupo bateu com "${settings.groupGerentes}".`);
  return mapped;
}

function stopKeepalive() {
  if (runtime.keepaliveTimer) {
    clearInterval(runtime.keepaliveTimer);
    runtime.keepaliveTimer = undefined;
  }
  if (runtime.lockTimer) {
    clearInterval(runtime.lockTimer);
    runtime.lockTimer = undefined;
  }
}

function startKeepalive() {
  stopKeepalive();
  runtime.lockTimer = setInterval(() => {
    touchWhatsAppSessionLock();
  }, LOCK_HEARTBEAT_MS);
  runtime.keepaliveTimer = setInterval(() => {
    const sock = runtime.socket;
    if (!sock || getSnapshot().whatsapp !== "connected") return;
    touchWhatsAppSessionLock();
    void sock.sendPresenceUpdate("available").catch(() => undefined);
  }, KEEPALIVE_MS);
}

function reconnectDelayMs(statusCode: number | undefined) {
  if (statusCode === DisconnectReason.connectionReplaced) return 12_000;
  if (statusCode === DisconnectReason.restartRequired) return 1_200;
  const attempt = Math.min(runtime.reconnectAttempt, 6);
  return Math.min(30_000, 1_500 * 2 ** attempt);
}

function scheduleReconnect(statusCode?: number) {
  if (!runtime.shouldReconnect || runtime.shuttingDown) return;
  runtime.reconnectAttempt += 1;
  const delay = reconnectDelayMs(statusCode);
  log("info", `WhatsApp reconectando em ${Math.round(delay / 1000)}s (código ${statusCode ?? "?"})…`);
  setTimeout(() => {
    connectWhatsApp().catch((error) => log("error", String(error)));
  }, delay);
}

async function gracefulWhatsAppShutdown(reason: string) {
  if (runtime.shuttingDown) return;
  runtime.shuttingDown = true;
  runtime.shouldReconnect = false;
  stopKeepalive();
  log("info", `Encerrando WhatsApp com elegância (${reason})…`);
  try {
    await runtime.socket?.end(undefined);
  } catch {
    // ignore
  }
  runtime.socket = null;
  runtime.connecting = false;
  releaseWhatsAppSessionLock();
}

function bindProcessSignals() {
  if (runtime.signalsBound) return;
  runtime.signalsBound = true;
  const onSignal = (signal: string) => {
    void gracefulWhatsAppShutdown(signal);
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("beforeExit", () => {
    releaseWhatsAppSessionLock();
  });
}

export async function connectWhatsApp() {
  if (process.env.DISABLE_WHATSAPP === "1") {
    setWhatsAppState("disconnected", {
      whatsappError: "WhatsApp desligado neste ambiente (DISABLE_WHATSAPP=1).",
    });
    log("info", "WhatsApp desligado por DISABLE_WHATSAPP=1 (evita roubar a sessão da produção).");
    return getSnapshot();
  }
  if (runtime.shuttingDown) return getSnapshot();
  if (runtime.socket) {
    await waitUntil(12_000, () => {
      const state = getSnapshot().whatsapp;
      return state === "qr" || state === "connected" || state === "error" || Boolean(runtime.qrPng);
    });
    return getSnapshot();
  }
  if (runtime.connecting) {
    await waitUntil(12_000, () => Boolean(runtime.socket) || getSnapshot().whatsapp === "error");
    await waitUntil(12_000, () => {
      const state = getSnapshot().whatsapp;
      return state === "qr" || state === "connected" || state === "error" || Boolean(runtime.qrPng);
    });
    return getSnapshot();
  }
  runtime.connecting = true;
  runtime.shouldReconnect = true;
  runtime.shuttingDown = false;
  ensureDataDirs();
  bindProcessSignals();

  const locked = await acquireWhatsAppSessionLock();
  if (!locked) {
    runtime.connecting = false;
    setWhatsAppState("error", {
      whatsappError: "Outra instância está usando a sessão WhatsApp. Aguarde o deploy terminar.",
    });
    scheduleReconnect(DisconnectReason.connectionReplaced);
    return getSnapshot();
  }

  try {
    const hasAuth = hasRegisteredWhatsAppAuth();
    if (hasAuth) {
      log("info", "Sessão WhatsApp salva no volume — reconectando sem QR.");
    } else if (authFilesPresent()) {
      log("warn", "Arquivos de auth existem, mas sessão não registrada — pode pedir QR.");
    } else {
      log("info", "Iniciando sessão WhatsApp. Escaneie o QR com o celular.");
    }

    // Baileys helper — not a React Hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    setWhatsAppState("connecting", { whatsappError: null });

    runtime.socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ["Unik BKO", "Chrome", "124.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 500,
    });

    runtime.socket.ev.on("creds.update", saveCreds);
    runtime.socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const message of messages) {
        try {
          await handleIncomingCommand(message);
        } catch (error) {
          log("warn", `Falha ao ler mensagem WhatsApp: ${String(error)}`);
        }
      }
    });
    runtime.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try {
          await saveQr(qr);
        } catch (error) {
          log("error", `Não consegui desenhar o QR: ${String(error)}`);
        }
      }
      if (connection === "open") {
        runtime.qrPng = null;
        runtime.reconnectAttempt = 0;
        setWhatsAppState("connected", { qrDataUrl: null, whatsappError: null });
        startKeepalive();
        touchWhatsAppSessionLock();
        const me = runtime.socket?.user?.id ?? "sessão";
        const meDigits = onlyDigits(me.split(":")[0] || me);
        log(
          "info",
          `WhatsApp conectado como ${me}. Número do robô: ${meDigits || "desconhecido"}. Avisos nos grupos + cópia de validação no 48 99194-0908.`,
        );
        await refreshGroups().catch((error) => {
          log("warn", `Não consegui listar os grupos: ${String(error)}`);
        });
        await resolveOwnerSendJids().catch(() => undefined);
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const replaced = statusCode === DisconnectReason.connectionReplaced;
        stopKeepalive();
        runtime.socket = null;
        runtime.connecting = false;

        if (loggedOut) {
          runtime.qrPng = null;
          // Só apaga auth em logout real no celular — nunca em queda de rede/deploy.
          fs.rmSync(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
          fs.rmSync(QR_PNG_PATH, { force: true });
          releaseWhatsAppSessionLock();
          setWhatsAppState("disconnected", {
            qrDataUrl: null,
            groups: [],
            whatsappError: "Sessão encerrada no celular. Gere um QR novo.",
          });
          log("warn", "WhatsApp deslogou no celular (401). Precisa escanear QR de novo.");
          if (runtime.shouldReconnect && !runtime.shuttingDown) {
            scheduleReconnect(statusCode);
          }
          return;
        }

        if (replaced) {
          setWhatsAppState("connecting", {
            whatsappError: "Outra conexão assumiu a sessão — aguardando e reconectando…",
          });
          log("warn", "WhatsApp 440 connectionReplaced (típico no redeploy). Mantendo auth e aguardando.");
          releaseWhatsAppSessionLock();
          scheduleReconnect(statusCode);
          return;
        }

        // Queda transitória: NÃO mostrar QR se a sessão registrada ainda existe.
        const keepSession = hasRegisteredWhatsAppAuth();
        setWhatsAppState(keepSession ? "connecting" : getSnapshot().qrDataUrl ? "qr" : "connecting", {
          whatsappError: null,
        });
        log(
          "warn",
          keepSession
            ? `WhatsApp caiu (${statusCode ?? "?"}) — reconectando com sessão salva (sem apagar auth).`
            : `WhatsApp caiu (${statusCode ?? "?"}) — reconectando…`,
        );
        scheduleReconnect(statusCode);
      }
    });

    await waitUntil(15_000, () => {
      const state = getSnapshot().whatsapp;
      return state === "qr" || state === "connected" || state === "error" || Boolean(runtime.qrPng);
    });
  } catch (error) {
    runtime.connecting = false;
    runtime.socket = null;
    const message = error instanceof Error ? error.message : String(error);
    setWhatsAppState("error", { whatsappError: message });
    log("error", `Falha ao iniciar WhatsApp: ${message}`);
    scheduleReconnect(undefined);
  } finally {
    runtime.connecting = false;
  }

  return getSnapshot();
}

export async function getQrPng(): Promise<Buffer | null> {
  if (runtime.qrPng) return runtime.qrPng;
  if (fs.existsSync(QR_PNG_PATH)) {
    runtime.qrPng = fs.readFileSync(QR_PNG_PATH);
    return runtime.qrPng;
  }
  await connectWhatsApp();
  if (runtime.qrPng) return runtime.qrPng;
  if (fs.existsSync(QR_PNG_PATH)) {
    runtime.qrPng = fs.readFileSync(QR_PNG_PATH);
    return runtime.qrPng;
  }
  const dataUrl = getSnapshot().qrDataUrl;
  if (dataUrl?.startsWith("data:image/png;base64,")) {
    runtime.qrPng = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
    return runtime.qrPng;
  }
  return null;
}

export async function disconnectWhatsApp() {
  runtime.shouldReconnect = false;
  stopKeepalive();
  try {
    await runtime.socket?.end(undefined);
  } catch {
    // ignore
  }
  runtime.socket = null;
  runtime.connecting = false;
  runtime.qrPng = null;
  releaseWhatsAppSessionLock();
  setWhatsAppState("disconnected", { qrDataUrl: null, groups: [] });
}

/** Apaga a sessão salva e abre um QR novo para parear de novo. */
export async function regenerateWhatsAppQr() {
  await disconnectWhatsApp();
  ensureDataDirs();
  fs.rmSync(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
  fs.rmSync(QR_PNG_PATH, { force: true });
  fs.mkdirSync(WHATSAPP_AUTH_DIR, { recursive: true });
  // Pequena pausa para o socket antigo soltar de vez.
  await new Promise((resolve) => setTimeout(resolve, 800));
  runtime.shouldReconnect = true;
  runtime.shuttingDown = false;
  runtime.reconnectAttempt = 0;
  return connectWhatsApp();
}

export function getWhatsAppAuthMeta() {
  return {
    authPresent: authFilesPresent(),
    authRegistered: hasRegisteredWhatsAppAuth(),
    volumeMount: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
  };
}

async function resolveOwnerSendJids() {
  const digits = ownerDigits();
  const list: string[] = [];
  const saved = resolveOwnerJid();
  if (saved) list.push(saved);
  if (runtime.socket) {
    try {
      const found = await runtime.socket.onWhatsApp(digits);
      for (const row of found ?? []) {
        if (row.exists && row.jid) {
          list.push(row.jid);
          persistOwnerJid(row.jid);
          log("info", `Número 48 99194-0908 encontrado no WhatsApp: ${row.jid}`);
        }
      }
    } catch (error) {
      log("warn", `Não confirmei o 48 99194-0908 no WhatsApp: ${String(error)}`);
    }
  }
  list.push(`${digits}@s.whatsapp.net`);
  return Array.from(new Set(list));
}

async function sendValidationCopy(text: string) {
  if (!runtime.socket) return null;
  const errors: string[] = [];
  for (const jid of await resolveOwnerSendJids()) {
    try {
      await runtime.socket.sendMessage(jid, { text });
      persistOwnerJid(jid);
      log("info", `Cópia de validação enviada para 48 99194-0908 (${jid}).`);
      return jid;
    } catch (error) {
      errors.push(`${jid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log("error", `Cópia de validação não chegou no 48 99194-0908. ${errors.join(" | ")}`);
  return null;
}

export async function sendWhatsAppText(text: string, targets: WhatsAppTarget[]) {
  if (!runtime.socket || getSnapshot().whatsapp !== "connected") {
    throw new Error("WhatsApp ainda não está conectado. Escaneie o QR.");
  }
  const unique = Array.from(new Set(targets));
  const groups = unique.some((target) => target === "bko" || target === "gerentes")
    ? getSnapshot().groups.length
      ? getSnapshot().groups
      : await refreshGroups()
    : getSnapshot().groups;
  const sentTo: string[] = [];

  for (const target of unique.filter((item) => item !== "owner")) {
    const group = groups.find((item) => item.matched === target);
    if (!group) {
      log("error", `Grupo ${target} não encontrado na lista do WhatsApp.`);
      continue;
    }
    try {
      await runtime.socket.sendMessage(group.id, { text });
      sentTo.push(group.name);
      log("info", `WhatsApp enviado para o grupo ${group.name}.`);
    } catch (error) {
      log("error", `Falha ao enviar para o grupo ${group.name}: ${String(error)}`);
    }
  }

  if (unique.includes("owner")) {
    const ok = await sendValidationCopy(text);
    if (ok) sentTo.push("WhatsApp pessoal (validação 48 99194-0908)");
  }

  if (!sentTo.length) {
    throw new Error("Não achei destino no WhatsApp (grupos BKO/Gerentes ou 48 99194-0908).");
  }
  return sentTo;
}

export function isWhatsAppReady() {
  return Boolean(runtime.socket) && getSnapshot().whatsapp === "connected";
}

/** Envia texto 1:1 para um JID ou número (com DDI 55 se faltar). */
export async function sendDirectWhatsApp(to: string, text: string) {
  if (!runtime.socket || getSnapshot().whatsapp !== "connected") {
    throw new Error("WhatsApp ainda não está conectado. Escaneie o QR.");
  }
  let jid = to.trim();
  if (!jid.includes("@")) {
    const digits = onlyDigits(jid);
    const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
    jid = `${withCountry}@s.whatsapp.net`;
  }
  await runtime.socket.sendMessage(jid, { text });
  log("info", `WhatsApp direto enviado para ${jid}.`);
  return jid;
}
