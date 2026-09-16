import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { loadSettings } from "@/lib/settings";
import { getSnapshot, log, setHourlyNote } from "@/lib/store";
import { connectWhatsApp, isWhatsAppReady } from "@/lib/whatsapp";

const HOURLY_STATE_PATH = path.join(DATA_DIR, "hourly-state.json");
const INTERVAL_MS = Number(process.env.HOURLY_MS || 60 * 60 * 1000);
const TICK_MS = 30_000;
const FIRST_DELAY_MS = 90_000;

type HourlyState = { lastRunAt: number };

const globalForSched = globalThis as typeof globalThis & {
  unikBkoScheduler?: { started: boolean; startedAt: number; timer?: ReturnType<typeof setInterval> };
};

function loadHourlyState(): HourlyState {
  ensureDataDirs();
  if (!fs.existsSync(HOURLY_STATE_PATH)) return { lastRunAt: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(HOURLY_STATE_PATH, "utf8")) as HourlyState;
    return { lastRunAt: Number(parsed.lastRunAt) || 0 };
  } catch {
    return { lastRunAt: 0 };
  }
}

function saveHourlyState(state: HourlyState) {
  ensureDataDirs();
  fs.writeFileSync(HOURLY_STATE_PATH, JSON.stringify(state));
}

function hasCredentials() {
  const settings = loadSettings();
  return Boolean(settings.crmUser && settings.crmPass && settings.gedUser && settings.gedPass);
}

async function tick() {
  const slot = globalForSched.unikBkoScheduler;
  if (!slot?.started) return;
  if (!isWhatsAppReady()) return;
  if (!hasCredentials()) return;
  if (getSnapshot().job === "running") return;

  const state = loadHourlyState();
  if (state.lastRunAt === 0 && Date.now() - slot.startedAt < FIRST_DELAY_MS) return;
  if (state.lastRunAt > 0 && Date.now() - state.lastRunAt < INTERVAL_MS) return;

  try {
    const { startHourlyRun } = await import("@/lib/pipeline");
    startHourlyRun();
    saveHourlyState({ lastRunAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", `Leitura automática não iniciou: ${message}`);
    setHourlyNote(`Leitura automática não iniciou: ${message}`);
  }
}

export function startBackgroundServices() {
  const slot = globalForSched.unikBkoScheduler ?? {
    started: false,
    startedAt: Date.now(),
  };
  globalForSched.unikBkoScheduler = slot;
  if (slot.started) return;
  slot.started = true;
  slot.startedAt = Date.now();
  log("info", "Serviços de fundo: WhatsApp + leitura de hora em hora no 48 99194-0908.");
  void connectWhatsApp().catch((error) => log("error", String(error)));
  slot.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
