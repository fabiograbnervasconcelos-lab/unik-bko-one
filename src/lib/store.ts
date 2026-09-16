export type WhatsAppState =
  | "disconnected"
  | "qr"
  | "connecting"
  | "connected"
  | "error";

export type JobState = "idle" | "running" | "review" | "done" | "error";

export type LogLevel = "info" | "warn" | "error";

export type LogLine = {
  ts: string;
  level: LogLevel;
  message: string;
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  matched: "bko" | "gerentes" | null;
};

export type LeadResult = {
  id: string;
  name: string;
  cpf: string;
  crmStatus: string;
  hasDigitization: boolean;
  gedResult: string | null;
  draftMessage: string | null;
  notified: boolean;
  skipped: boolean;
  notifyTargets: string[];
  error?: string;
};

export type AppSnapshot = {
  whatsapp: WhatsAppState;
  whatsappError: string | null;
  qrDataUrl: string | null;
  groups: WhatsAppGroup[];
  job: JobState;
  jobError: string | null;
  step: string;
  logs: LogLine[];
  results: LeadResult[];
  screenshots: string[];
  updatedAt: string;
  stopRequested: boolean;
  lastHourlyAt: string | null;
  hourlyNote: string | null;
  ownerJid: string | null;
};

const MAX_LOGS = 250;

const globalForApp = globalThis as typeof globalThis & {
  unikBkoSnapshot?: AppSnapshot;
};

const snapshot: AppSnapshot = globalForApp.unikBkoSnapshot ?? {
  whatsapp: "disconnected",
  whatsappError: null,
  qrDataUrl: null,
  groups: [],
  job: "idle",
  jobError: null,
  step: "Aguardando conexão do WhatsApp.",
  logs: [],
  results: [],
  screenshots: [],
  updatedAt: new Date().toISOString(),
  stopRequested: false,
  lastHourlyAt: null,
  hourlyNote: null,
  ownerJid: null,
};

globalForApp.unikBkoSnapshot = snapshot;

function touch() {
  snapshot.updatedAt = new Date().toISOString();
}

export function getSnapshot(): AppSnapshot {
  return snapshot;
}

export function log(level: LogLevel, message: string) {
  snapshot.logs = [
    ...snapshot.logs.slice(-(MAX_LOGS - 1)),
    { ts: new Date().toISOString(), level, message },
  ];
  touch();
}

export function setWhatsAppState(
  state: WhatsAppState,
  extra: Partial<Pick<AppSnapshot, "qrDataUrl" | "whatsappError" | "groups">> = {},
) {
  snapshot.whatsapp = state;
  if ("qrDataUrl" in extra) snapshot.qrDataUrl = extra.qrDataUrl ?? null;
  if ("whatsappError" in extra) snapshot.whatsappError = extra.whatsappError ?? null;
  if ("groups" in extra) snapshot.groups = extra.groups ?? [];
  if (state === "connected") snapshot.qrDataUrl = null;
  touch();
}

export function setJob(state: JobState, extra: { error?: string | null; step?: string } = {}) {
  snapshot.job = state;
  if ("error" in extra) snapshot.jobError = extra.error ?? null;
  if (extra.step) snapshot.step = extra.step;
  touch();
}

export function setStep(step: string) {
  snapshot.step = step;
  touch();
}

export function setResults(results: LeadResult[]) {
  snapshot.results = results;
  touch();
}

export function patchResult(id: string, patch: Partial<LeadResult>) {
  snapshot.results = snapshot.results.map((row) =>
    row.id === id ? { ...row, ...patch } : row,
  );
  touch();
}

export function setScreenshots(files: string[]) {
  snapshot.screenshots = files;
  touch();
}

export function requestStop() {
  snapshot.stopRequested = true;
  snapshot.step = "Parando envio...";
  touch();
}

export function isStopRequested() {
  return snapshot.stopRequested;
}

export function clearStop() {
  snapshot.stopRequested = false;
  touch();
}

export function clearRun() {
  snapshot.results = [];
  snapshot.jobError = null;
  snapshot.job = "idle";
  snapshot.stopRequested = false;
  snapshot.step = "Pronto para verificar CRM e GED360.";
  touch();
}

export function setHourlyNote(note: string, ran = true) {
  snapshot.hourlyNote = note;
  if (ran) snapshot.lastHourlyAt = new Date().toISOString();
  touch();
}

export function setOwnerJid(jid: string) {
  snapshot.ownerJid = jid;
  touch();
}
