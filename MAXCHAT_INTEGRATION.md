# Integração MaxChat ↔ Plantao (IA)

Este documento descreve o que precisa ser implementado no **MaxChat** para que o robô de plantão funcione.

---

## 1. Presença do atendente (`lastSeenAt`)

### Schema Prisma — adicionar campo no model `User`

```prisma
model User {
  // ... campos existentes ...
  lastSeenAt DateTime?
}
```

Rodar após a alteração:
```bash
npx prisma migrate dev --name add_last_seen_at
```

---

## 2. Endpoint de heartbeat

Cria o arquivo `app/api/v1/presence/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
```

O **frontend** deve chamar `POST /api/v1/presence` a cada **30 segundos** enquanto o atendente estiver com o painel aberto:

```typescript
// em qualquer layout/componente raiz do painel
useEffect(() => {
  const interval = setInterval(() => {
    fetch("/api/v1/presence", { method: "POST" });
  }, 30_000);
  return () => clearInterval(interval);
}, []);
```

---

## 3. Função utilitária — verificar se há agente online

Cria ou adiciona em `lib/presence.ts`:

```typescript
import { prisma } from "@/lib/prisma";

/** Retorna true se pelo menos um atendente fez heartbeat nos últimos 10 minutos */
export async function hasAgentOnline(): Promise<boolean> {
  const limite = new Date(Date.now() - 10 * 60 * 1000);
  const count = await prisma.user.count({
    where: {
      role: "agent",
      status: "active",
      lastSeenAt: { gte: limite },
    },
  });
  return count > 0;
}
```

---

## 4. Dispatch para o Plantao no webhook de entrada

No arquivo que processa mensagens recebidas do Evolution API (provavelmente `app/api/webhooks/inbound/route.ts`), **após salvar a mensagem no banco**, adicionar:

```typescript
import { hasAgentOnline } from "@/lib/presence";

// após salvar a mensagem...
const agentOnline = await hasAgentOnline();
if (!agentOnline) {
  // despacha para o plantao (IA)
  const plantaoUrl = process.env.PLANTAO_WEBHOOK_URL; // ex: http://plantao:3000/webhooks/maxchat
  const plantaoSecret = process.env.PLANTAO_WEBHOOK_SECRET;

  if (plantaoUrl) {
    fetch(plantaoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(plantaoSecret ? { "X-MaxChat-Secret": plantaoSecret } : {}),
      },
      body: JSON.stringify({
        event: "message",
        channelNumber: msg.channelNumber,   // número da empresa
        messageId: msg.id,
        from: client.phone,                 // número do cliente
        name: client.name,
        timestamp: Math.floor(Date.now() / 1000),
        type: msg.type,                     // "text" | "image" | "audio" | "video"
        text: msg.text,
        mediaUrl: msg.mediaUrl,
      }),
    }).catch((err) => console.error("Erro ao despachar para plantao:", err));
  }
}
```

### Variáveis de ambiente a adicionar no `.env` do MaxChat:

```
# URL do serviço plantao (ajustar após deploy)
PLANTAO_WEBHOOK_URL=http://plantao:3000/webhooks/maxchat
# Segredo compartilhado com o plantao
PLANTAO_WEBHOOK_SECRET=troque-este-segredo
```

---

## 5. Endpoint de envio de mensagem

O plantao chama `POST /api/v1/mensagem` para enviar respostas. Cria o arquivo `app/api/v1/mensagem/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // valida API key
  const auth = req.headers.get("authorization") ?? "";
  const apiKey = process.env.MAXCHAT_INTERNAL_API_KEY;
  if (apiKey && auth !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientPhone, message } = await req.json();
  if (!clientPhone || !message) {
    return NextResponse.json({ error: "clientPhone e message são obrigatórios" }, { status: 400 });
  }

  // envia via Evolution API
  const evolutionUrl = process.env.EVOLUTION_API_URL; // ex: http://evolution_api:8080
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

  const phone = clientPhone.replace(/\D/g, "");

  const res = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: evolutionKey ?? "" },
    body: JSON.stringify({ number: phone, text: message }),
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Evolution API: ${res.status} ${body}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
```

### Variáveis de ambiente adicionais:

```
MAXCHAT_INTERNAL_API_KEY=troque-este-segredo
EVOLUTION_API_URL=http://evolution_api:8080
EVOLUTION_API_KEY=masterkey123
EVOLUTION_INSTANCE_NAME=maxchat-teste-temporario
```

---

## Resumo das variáveis de ambiente (MaxChat `.env`)

```
PLANTAO_WEBHOOK_URL=http://plantao:3000/webhooks/maxchat
PLANTAO_WEBHOOK_SECRET=troque-este-segredo
MAXCHAT_INTERNAL_API_KEY=troque-este-segredo
EVOLUTION_API_URL=http://evolution_api:8080
EVOLUTION_API_KEY=masterkey123
EVOLUTION_INSTANCE_NAME=maxchat-teste-temporario
```

---

## Fluxo completo

```
Cliente envia WhatsApp
        ↓
Evolution API (QR Session)
        ↓
MaxChat /api/webhooks/inbound
        ↓
Salva mensagem no banco
        ↓
Tem atendente online? (lastSeenAt < 10min)
   SIM → nada (atendente responde manualmente)
   NÃO → POST /webhooks/maxchat no Plantao
              ↓
          IA processa e responde
              ↓
          POST /api/v1/mensagem no MaxChat
              ↓
          MaxChat envia via Evolution API
              ↓
          Cliente recebe resposta no WhatsApp
```
