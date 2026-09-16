FROM node:20-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=43147
EXPOSE 43147

CMD ["node", "scripts/start.mjs"]
