# Unik BKO One — CRM × GED360

Painel interno da Unik Telecom para o time de BKO.

O sistema:

1. Conecta o WhatsApp com QR Code (você lê no celular).
2. Entra no CRM [Proadmin Unik](https://uniktelecom.com.br/proadmin/login.php).
3. Filtra quem está em **cancelado/bio expirada** e **aguardando biometria**.
4. Entra no [GED360 BrProntoPDV](https://ged360.niointernet.com.br/brprontopdv/autenticacao/index), aceita cookies e abre **Consultar → Digitalizações → busca unitária CPF**.
5. Se aparecer a tela de digitalização e o **Resultado da Análise** for um destes, manda WhatsApp para os grupos **BKO One Urgente** e **Gerentes One**:
   - Doc. Apto para Venda
   - Concluído
   - NÃO PASSÍVEL DE ANÁLISE
   - ALERTA DE RISCO
   - NEUTRO
   - EM ANÁLISE
   - COM RISCO

## Como rodar

Precisa de Node 20+ e Chrome/Chromium.

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:43147`.

1. Escaneie o QR com o WhatsApp da operação.
2. Preencha usuário/senha do CRM e do GED360 (domínio BrPronto por padrão).
3. Confira se os dois grupos apareceram com o selo certo.
4. Clique em **Rodar verificação agora**.

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
