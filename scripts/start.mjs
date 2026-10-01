import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.TZ = process.env.TZ || "America/Sao_Paulo";

const port = process.env.PORT || "43147";
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "0.0.0.0", "--port", port],
  {
    stdio: "inherit",
    env: { ...process.env, TZ: process.env.TZ || "America/Sao_Paulo" },
  },
);

function forwardSignal(signal) {
  if (!child.killed) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

// Railway manda SIGTERM no redeploy — repassa e espera o Next/Baileys fechar a sessão.
process.on("SIGTERM", () => {
  forwardSignal("SIGTERM");
  // drainingSeconds=45 no Railway; aqui esperamos o filho sair.
});
process.on("SIGINT", () => {
  forwardSignal("SIGINT");
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 1);
});
