FROM node:20-bookworm

# Rebuild marker: force Railway to pick up vendor bot + fatura opção 6.
ARG BUILD_STAMP=fatura-opcao-6-2026-09-19
LABEL unik.bko.build="${BUILD_STAMP}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=43147
EXPOSE 43147

CMD ["node", "scripts/start.mjs"]
