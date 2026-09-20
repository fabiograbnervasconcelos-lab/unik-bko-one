FROM node:20-bookworm

# Rebuild marker: UI WhatsApp CRM vs CRM×GED via APP_MODE.
ARG BUILD_STAMP=cobertura-ex-gen-20260920
LABEL unik.bko.build="${BUILD_STAMP}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=43147
ENV TZ=America/Sao_Paulo
EXPOSE 43147

CMD ["node", "scripts/start.mjs"]
