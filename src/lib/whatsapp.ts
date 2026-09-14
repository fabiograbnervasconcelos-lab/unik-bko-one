import fs from "node:fs";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { ensureDataDirs, WHATSAPP_AUTH_DIR } from "@/lib/paths";
import { loadSettings } from "@/lib/settings";
import { getSnapshot, log, setWhatsAppState } from "@/lib/store";
import { scoreGroupName } from "@/lib/text";

const logger = pino({ level: "silent" });

type WhatsAppRuntime = {
  socket: WASocket | null;
  connecting: boolean;
  shouldReconnect: boolean;
};

const globalForWa = globalThis as typeof globalThis & {
  unikBkoWhatsApp?: WhatsAppRuntime;
};

const runtime: WhatsAppRuntime = globalForWa.unikBkoWhatsApp ?? {
  socket: null,
  connecting: false,
  shouldReconnect: true,
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

export async function connectWhatsApp() {
  if (runtime.socket) {
    return getSnapshot();
  }
  if (runtime.connecting) return getSnapshot();
  runtime.connecting = true;
  runtime.shouldReconnect = true;
  ensureDataDirs();

  try {
    // Baileys helper — not a React Hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    setWhatsAppState("connecting", { whatsappError: null });
    log("info", "Iniciando sessão WhatsApp. Escaneie o QR com o celular.");

    runtime.socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ["Unik BKO", "Chrome", "124.0.0"],
      markOnlineOnConnect: false,
    });

    runtime.socket.ev.on("creds.update", saveCreds);
    runtime.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 420,
          color: { dark: "#111827", light: "#ffffff" },
        });
        setWhatsAppState("qr", { qrDataUrl, whatsappError: null });
        log("info", "QR Code gerado. Abra o WhatsApp → Aparelhos conectados → Conectar.");
      }
      if (connection === "open") {
        setWhatsAppState("connected", { qrDataUrl: null, whatsappError: null });
        log("info", "WhatsApp conectado.");
        await refreshGroups().catch((error) => {
          log("warn", `Não consegui listar os grupos: ${String(error)}`);
        });
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        runtime.socket = null;
        runtime.connecting = false;
        if (loggedOut) {
          fs.rmSync(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
          setWhatsAppState("disconnected", {
            qrDataUrl: null,
            groups: [],
            whatsappError: "Sessão encerrada no celular. Gere um QR novo.",
          });
          log("warn", "WhatsApp deslogou. Vou gerar um QR novo.");
          if (runtime.shouldReconnect) {
            setTimeout(() => {
              connectWhatsApp().catch((error) => log("error", String(error)));
            }, 1200);
          }
          return;
        }
        setWhatsAppState("connecting", { qrDataUrl: null });
        log("warn", "WhatsApp caiu. Reconectando...");
        if (runtime.shouldReconnect) {
          setTimeout(() => {
            connectWhatsApp().catch((error) => log("error", String(error)));
          }, 2000);
        }
      }
    });
  } catch (error) {
    runtime.connecting = false;
    runtime.socket = null;
    const message = error instanceof Error ? error.message : String(error);
    setWhatsAppState("error", { whatsappError: message });
    log("error", `Falha ao iniciar WhatsApp: ${message}`);
  } finally {
    runtime.connecting = false;
  }

  return getSnapshot();
}

export async function disconnectWhatsApp() {
  runtime.shouldReconnect = false;
  try {
    await runtime.socket?.end(undefined);
  } catch {
    // ignore
  }
  runtime.socket = null;
  setWhatsAppState("disconnected", { qrDataUrl: null, groups: [] });
}

export async function sendWhatsAppText(text: string, targets: Array<"bko" | "gerentes">) {
  if (!runtime.socket || getSnapshot().whatsapp !== "connected") {
    throw new Error("WhatsApp ainda não está conectado. Escaneie o QR.");
  }
  const groups = getSnapshot().groups.length
    ? getSnapshot().groups
    : await refreshGroups();
  const sentTo: string[] = [];
  for (const target of targets) {
    const group = groups.find((item) => item.matched === target);
    if (!group) {
      log("error", `Grupo ${target} não encontrado na lista do WhatsApp.`);
      continue;
    }
    await runtime.socket.sendMessage(group.id, { text });
    sentTo.push(group.name);
    log("info", `WhatsApp enviado para ${group.name}.`);
  }
  if (!sentTo.length) {
    throw new Error("Não achei os grupos BKO One Urgente e Gerentes One.");
  }
  return sentTo;
}

export function isWhatsAppReady() {
  return Boolean(runtime.socket) && getSnapshot().whatsapp === "connected";
}
