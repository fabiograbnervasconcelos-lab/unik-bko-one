#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tunnel = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(tunnel)) {
  console.error("usage: render-here-now.mjs https://xxxx.trycloudflare.com");
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unik BKO One — painel ao vivo</title>
    <style>
      html, body { margin: 0; height: 100%; background: #171717; color: #fafafa; font-family: ui-sans-serif, system-ui, sans-serif; }
      .bar {
        height: 36px; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 0 12px; background: #111; border-bottom: 1px solid #333;
        font-size: 12px; color: #a1a1aa;
      }
      .bar a { color: #fbbf24; }
      iframe { border: 0; width: 100%; height: calc(100% - 36px); display: block; background: #171717; }
    </style>
  </head>
  <body>
    <div class="bar">
      <span>Unik BKO One · painel ao vivo nesta página</span>
      <a href="${tunnel}/" target="_top" rel="noreferrer">abrir direto</a>
    </div>
    <iframe
      src="${tunnel}/"
      title="Unik BKO One"
      allow="clipboard-write"
    ></iframe>
  </body>
</html>
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "here-now-site", "index.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
