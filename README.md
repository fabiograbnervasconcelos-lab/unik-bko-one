# Unik BKO One — CRM × GED360

Painel interno da Unik Telecom para o time de BKO.

O sistema:

1. Conecta o WhatsApp com QR Code (você lê no celular).
2. Entra no CRM [Proadmin Unik](https://uniktelecom.com.br/proadmin/login.php).
3. Filtra quem está em **cancelado/bio expirada** e **aguardando biometria**.
4. Entra no [GED360 BrProntoPDV](https://ged360.niointernet.com.br/brprontopdv/autenticacao/index), aceita cookies e abre **Consultar → Digitalizações → busca unitária CPF**.
5. Se o GED360 mostrar um status, o painel monta o texto do WhatsApp e mostra um **preview**. Você valida e clica em enviar para **BKO One Urgente** e **Gerentes One**. Se a busca não achar nada, **não monta mensagem**.

## Como rodar

Precisa de Node 20+ e Chrome/Chromium.

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:43147` (Preview do Cursor) ou a página here.now que embute o túnel, enquanto este servidor estiver ligado.

O here.now sozinho não executa CRM/GED/WhatsApp. O script `scripts/keep-tunnel.sh` abre um túnel até a porta 43147 e republica o iframe.

## Railway, Render e here.now

O painel precisa de Chrome/Playwright, WhatsApp sempre ligado e disco para a sessão. Por isso o deploy usa Docker (`Dockerfile`), não Vercel.

- **here.now:** https://cozy-delta-bsqr.here.now/ — página permanente; o robô só roda se o túnel/servidor estiver no ar.
- **Railway:** `railway up -y --name unik-bko-one` (sobe o Dockerfile e gera `*.up.railway.app`). Monte um volume em `/app/data` para não perder o WhatsApp.
- **Render:** Blueprint em `render.yaml` (Docker + disco em `/app/data`). O Render precisa de um repositório Git ou de uma imagem Docker.

Produção escuta `PORT` (`npm start` → `scripts/start.mjs`). Health check: `GET /api/health`.

1. Escaneie o QR com o WhatsApp da operação.
2. Preencha usuário/senha do CRM e do GED360 (domínio BrPronto por padrão).
3. Confira se os dois grupos apareceram com o selo certo.
4. Clique em **Rodar verificação agora**.
5. Confira o preview do WhatsApp, marque o que vale e clique em **Validar e enviar**.

Credenciais e a sessão do WhatsApp ficam em `data/` (fora do git).

Variáveis opcionais no `.env`:

```
CRM_USER=
CRM_PASS=
GED_USER=
GED_PASS=
GED_DOMAIN=1
WHATSAPP_GROUP_BKO=bko one urgente
WHATSAPP_GROUP_GERENTES=gerentes one
CHROME_PATH=/usr/local/bin/google-chrome
```

## Observações

- O WhatsApp entra como aparelho vinculado. Se o celular desconectar, o QR volta sozinho.
- Sem API oficial do CRM/GED, o robô usa o navegador. Se o layout do Proadmin mudar, os prints na tela ajudam a ajustar o filtro.
- Dá para colar CPFs extras no painel para testar o GED sem passar pelo CRM.
