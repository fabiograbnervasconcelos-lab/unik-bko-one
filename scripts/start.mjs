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

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
