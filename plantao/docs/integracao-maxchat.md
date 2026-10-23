# Integração MaxChat ↔ Plantão

O **MaxChat** é a porta do WhatsApp (Evolution API) e a tela dos atendentes. O **Plantão** é o agente: consulta o SGP, aplica a regra de liberação de confiança, detecta massivo, entende áudio, foto e vídeo e registra pendências.

Fluxo: o cliente manda mensagem → o MaxChat avisa o Plantão (webhook) → o Plantão decide se responde (fora do horário, massivo, pós-massivo) → responde pelo MaxChat no mesmo número → quando precisa de gente, pede ao MaxChat para transferir o atendimento para a fila certa.

## 1. MaxChat → Plantão (webhooks)

`POST {PLANTAO_URL}/webhooks/maxchat`

Cabeçalhos:
- `Content-Type: application/json`
- `X-MaxChat-Signature: sha256=<hex do HMAC-SHA256 do corpo bruto com o segredo compartilhado>`

O Plantão responde `200` na hora e processa em segundo plano. Reenvios do mesmo evento são ignorados pelo `message.id`.

### message.received

```json
{
  "event": "message.received",
  "event_id": "uuid",
  "ticket_id": "id do atendimento no MaxChat",
  "channel_id": "id do canal/instância que recebeu",
  "contact": { "phone": "5511900000003", "name": "Carla" },
  "message": {
    "id": "id único da mensagem",
    "type": "text | image | audio | ptt | video | document",
    "text": "texto, se houver",
    "caption": "legenda da mídia, se houver",
    "media_url": "link temporário (R2, válido por pelo menos 1h) quando for mídia",
    "mime_type": "image/jpeg"
  },
  "ticket": { "status": "open", "assigned_user_id": null, "bot_enabled": true },
  "agents_online": true,
  "timestamp": "2026-10-23T02:10:00Z"
}
```

Regras:
- Enviar **todas** as mensagens recebidas de clientes (o Plantão decide se responde pelo horário e pelo massivo).
- `bot_enabled: false` ou `assigned_user_id` preenchido = o Plantão **não responde**.
- Não enviar mensagens enviadas pelos atendentes nem pelo próprio robô.
- `agents_online`: `true` se algum atendente está com o MaxChat aberto agora (por exemplo, sinal de presença nos últimos 10 minutos). Com `false`, o Plantão atende mesmo dentro do horário da equipe (almoço, falta, plantão). Se o campo não vier, vale só o horário configurado no Plantão.

### ticket.assigned e ticket.closed

```json
{ "event": "ticket.assigned", "event_id": "uuid", "ticket_id": "...", "contact": { "phone": "5511900000003" }, "timestamp": "..." }
```

- `ticket.assigned`: um atendente assumiu. O Plantão para de responder nesse atendimento.
- `ticket.closed`: o atendimento foi encerrado. A próxima mensagem do cliente abre um novo.

## 2. Plantão → MaxChat (API do robô)

Autenticação: `Authorization: Bearer <token do robô>`. O token só pode usar estas duas rotas.

### Enviar mensagem

`POST {MAXCHAT_URL}/api/v1/bot/messages`

```json
{ "phone": "5511900000003", "text": "Boa noite, Carla! ..." }
```

Se o atendimento estiver com um atendente (`bot_enabled = false`), o MaxChat **não envia** e responde `409`: o Plantão sai desse atendimento. Caso contrário, o MaxChat envia **no atendimento aberto desse telefone e pelo mesmo canal em que ele chegou**. Se não houver atendimento aberto (aviso de normalização de massivo, despedida), usa o último canal em que o cliente falou. A mensagem aparece no histórico como enviada pelo robô. Resposta `200` com `{ "message_id": "..." }`; `404` se o telefone nunca falou com a empresa.

### Transferir para a fila

`POST {MAXCHAT_URL}/api/v1/bot/transfer`

```json
{ "phone": "5511900000003", "department": "suporte | financeiro | comercial | cancelamentos", "reason": "Cliente offline com LOS vermelho na ONU (foto). Chamado CH-1001", "priority": "alta | normal | baixa" }
```

O MaxChat coloca o atendimento na fila do departamento, grava o `reason` como nota interna visível ao atendente, **desliga o robô nesse atendimento** (`bot_enabled = false`) e preserva o histórico.

Mapeamento no MaxChat: `suporte` → SUPORTE TÉCNICO, `financeiro` → FINANCEIRO, `comercial` → COMERCIAL, `cancelamentos` → CANCELAMENTOS.

## 3. Envios em massa e WhatsApp por QR code

Avisos de massivo e despedidas saem um por vez, com pausa de cerca de 4 segundos (`ENVIO_MASSA_INTERVALO_MS`), e só para quem falou com a empresa nas últimas 24h e não está com um atendente. Com a Evolution conectada por QR code (WhatsApp Web, não oficial), o risco de bloqueio do número continua existindo; nos números principais, o recomendado é a API oficial da Meta.

## 4. Segurança

- Segredo do webhook e token do robô diferentes, guardados só no backend dos dois sistemas.
- HMAC conferido em todo webhook; corpo bruto, sem reformatar o JSON.
- Rate limit nas rotas do robô.
- Registros sem token e com telefone mascarado.

## 5. Configuração no Plantão

```
CANAL=maxchat
MAXCHAT_API_URL=https://maxchat.seudominio.com.br
MAXCHAT_API_TOKEN=<token do robô>
MAXCHAT_WEBHOOK_SECRET=<segredo compartilhado>
MAXCHAT_FILA_SUPORTE=suporte
MAXCHAT_FILA_FINANCEIRO=financeiro
MAXCHAT_FILA_COMERCIAL=comercial
MAXCHAT_FILA_CANCELAMENTOS=cancelamentos
ENVIO_MASSA_INTERVALO_MS=4000
# durante a homologação, só estes telefones são atendidos
HOMOLOGACAO_TELEFONES=5561999990003
```
