# Unik BKO One — CRM × GED360

Painel interno da Unik Telecom para o time de BKO.

O sistema:

1. Conecta o WhatsApp com QR Code (você lê no celular).
2. Entra no CRM [Proadmin Unik](https://uniktelecom.com.br/proadmin/login.php).
3. Filtra quem está em **cancelado/bio expirada** e **aguardando biometria**.
4. Entra no [GED360 BrProntoPDV](https://ged360.niointernet.com.br/brprontopdv/autenticacao/index), aceita cookies e abre a ficha do CPF.
5. Copia o **Resultado da Análise** da linha da ficha (ex.: `Doc. Apto para Venda`), mesmo quando essa linha sobe ou desce. Não usa o rodapé Regional.
6. De **hora em hora** lê sozinho e manda aviso nos grupos **BKO One Urgente** e **Gerentes One**. Uma cópia de validação vai para o WhatsApp **48 99194-0908**.
7. O botão **Validar e enviar** do painel continua valendo. O mesmo comando no WhatsApp (`validar e enviar`, enviado do 48 99194-0908) dispara a fila ou uma consulta nova.
8. **Zerar CRM e GED** limpa a consulta, os prints e desloga os dois sistemas. **Não desconecta o WhatsApp.**

## Bot WhatsApp para vendedores

Com o QR do painel logado, **qualquer vendedor** pode mandar mensagem no número da sessão:

1. O bot pede **usuário e senha** do CRM (cada um usa a própria conta).
2. Se o login der certo, responde **Logado** e envia o menu. Se falhar, avisa e pede para tentar de novo.
3. Opções (só **aba NIO**, sem Tim Fibra):
   - `(1)` Instalados (nome + OS, mês vigente + quantidade)
   - `(2)` Agendados (mês vigente + quantidade)
   - `(3)` Tratar quebra / Quebra em tratamento (quantidade)
   - `(4)` Cancelados do mês (quantidade)
   - `(5)` Ag. biometria (quantidade)
   - `(6)` Faturas clientes — pede CPF, consulta o [Robô One Telecom](https://robo-one-telecom-production.up.railway.app/), devolve Pix + PDF do boleto
   - `(7)` Encerrar e deslogar do CRM
4. Depois de cada busca, pergunta se precisa de mais alguma informação.
5. Se ainda estiver logado e mandar outra mensagem, o menu volta. Se encerrou (7) ou a sessão caiu, começa do zero.

A busca usa **Histórico NIO** (instalados/agendados/quebra/cancelados) e **Pré-venda NIO** (ag. biometria) com o filtro rápido da tabela — mais rápido que baixar Excel de 60 dias. Faturas usam a API do Robô One (`/api/consulta?doc=`).

Se o GED não mostrar Resultado da Análise, **não monta mensagem**.

## Como rodar

Precisa de Node 20+ e Chrome/Chromium.

```bash
npm install
npm test
npm run dev
```

Abra `http://127.0.0.1:43147`.

O here.now sozinho não executa CRM/GED/WhatsApp.

## Railway, Render e here.now

O painel precisa de Chrome/Playwright, WhatsApp sempre ligado e disco para a sessão. Por isso o deploy usa Docker (`Dockerfile`), não Vercel.

- **WhatsApp CRM (robô vendedores):** https://whatsapp-crm-production-1010.up.railway.app/ — app Railway separado (`unik-whatsapp-crm`). Conecte o QR com o **48 99645-0101**. Cada vendedor que mandar mensagem recebe resposta no próprio chat.
- **Railway (painel CRM × GED):** https://unik-bko-one-production.up.railway.app/ — continua rodando a verificação CRM/GED e os alertas nos grupos. Sem bot de vendedores (`DISABLE_VENDOR_BOT=1`).
- **Render:** https://unik-bko-one.onrender.com/ — Docker no plano free (sem disco persistente; a instância dorme quando fica ociosa).
- **here.now:** página permanente só com iframe; o robô só roda se o servidor (Railway) estiver no ar.

Produção do robô WhatsApp: `GET https://whatsapp-crm-production-1010.up.railway.app/api/health`. Versão: `GET .../api/version`.

1. Escaneie o QR com o WhatsApp da operação.
2. Preencha usuário/senha do CRM e do GED360 (domínio BrPronto por padrão).
3. Confira se os dois grupos apareceram com o selo certo.
4. A leitura automática começa cerca de 90 segundos depois do WhatsApp conectar, e depois de hora em hora.
5. No painel: **Rodar verificação agora** → preview → **Validar e enviar**.
6. No celular 48 99194-0908: mande `validar e enviar` no chat da sessão conectada.

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
OWNER_WHATSAPP=48991940908
CHROME_PATH=/usr/local/bin/google-chrome
```

## Observações

- O WhatsApp entra como aparelho vinculado. Se o celular desconectar, o QR volta sozinho.
- O aviso horário não reenvia o mesmo CPF + mesmo Resultado da Análise em 24 horas.
- Sem API oficial do CRM/GED, o robô usa o navegador. Se o layout do Proadmin mudar, os prints na tela ajudam a ajustar o filtro.
- Dá para colar CPFs extras no painel para testar o GED sem passar pelo CRM.
