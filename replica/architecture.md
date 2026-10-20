# Architecture: Plantão Maxgiga (agente de atendimento fora do horário + modo massivo)

Reconstrução das funções centrais do Maestro AI (agente no WhatsApp + registro de cada atendimento), no escopo decidido em `recon.md`: plantão fora do horário, modo massivo 24h, sem agendamento automático.
Nome provisório. O `/replica-brand` define o nome final.

## Stack

| layer | choice | why |
| --- | --- | --- |
| serviço | Node.js 22 + TypeScript + Fastify | um processo só recebe webhooks, conversa com o Claude e roda os jobs. Simples de manter numa VPS |
| IA | Claude API (SDK oficial `@anthropic-ai/sdk`) com tool use | o agente chama ferramentas (SGP, incidente, registrar pendência) em vez de inventar resposta. O modelo fica em config por rota (`MODEL_SUPORTE`, `MODEL_VENDAS`) e a escolha final é do usuário (ver Custos) |
| canal | adaptador `ChannelGateway` com 2 implementações: **Chat Mix** (preferida, depende da API deles) e **Meta Cloud API direta** (alternativa e ambiente de teste) | o número da API oficial só entrega para um sistema, então o agente precisa entrar pelo Chat Mix. O adaptador isola essa dúvida |
| mídia | pipeline `MediaProcessor`: **foto** vai direto ao Claude (visão nativa); **vídeo** passa pelo ffmpeg, que extrai ~6 quadros, analisados como imagens; **áudio** é transcrito (Whisper local na VPS via whisper.cpp, ou API de transcrição se a VPS for fraca) e o texto entra na conversa marcado como "transcrição de áudio" | o Claude lê imagem, mas não recebe áudio nem vídeo direto |
| SGP | adaptador `SgpClient` (API REST do SGP com token próprio) | cliente, faturas, desbloqueio, chamado, status online/offline. Os endpoints exatos serão confirmados na doc do SGP |
| banco | Postgres 16 em Docker na VPS | um banco só, dentro da VPS que já existe, sem custo extra |
| ORM | Drizzle | migrations versionadas, SQL legível |
| painel | página web pequena servida pelo mesmo Fastify (HTML + htmx) | só o necessário: abrir/fechar incidente, previsão, horários, base de conhecimento. O atendimento em si continua no Chat Mix |
| auth do painel | login com e-mail e senha (argon2) + sessão em cookie http-only, papéis admin e atendente | 2 a 4 usuários internos, sem serviço externo |
| jobs | agendador dentro do processo (node-cron) + fila no Postgres (`pg-boss`) | varredura do SGP a cada 2 min, retries de envio, avisos do massivo |
| deploy | Docker Compose na VPS atual + Caddy (HTTPS automático) num subdomínio da Maxgiga | o webhook precisa de HTTPS público |
| pagamentos / e-mail | não se aplica | |

## Schema

Tabelas: 11. Acesso: verificação de papel na camada de dados (todas as rotas do painel passam por `can(user, action)`). Os dados são de clientes (LGPD): ficam só na VPS, com retenção configurável.
SQL completo em `schema.sql`.

| tabela | para quê |
| --- | --- |
| `users` | equipe que usa o painel (admin, atendente) |
| `business_hours` | janelas em que há humano atendendo, por dia da semana |
| `holidays` | datas sem atendimento humano |
| `contacts` | quem falou com o agente: telefone, nome, CPF e id no SGP quando identificado |
| `conversations` | um atendimento: canal, status, assunto, quem resolveu, início e fim da IA |
| `messages` | histórico completo (cliente, IA, humano, sistema) |
| `incidents` | massivo: área, início, previsão, mensagem, fim |
| `incident_contacts` | quem chamou durante o incidente (para avisar a atualização e a normalização) |
| `pending_items` | a "fila da manhã": chamado técnico, pré-venda, conferência de pagamento, outros |
| `knowledge_items` | planos, preços, cobertura, FAQ, roteiro das luzes da ONU |
| `sgp_status_snapshots` | última leitura online/offline por cliente e área, usada para detectar massivo |

Restrições que importam:
- uma conversa aberta por contato (`unique` parcial em `conversations(contact_id) where status <> 'closed'`), para duas mensagens rápidas não abrirem dois atendimentos
- um incidente aberto por área (`unique` parcial), para o detector não abrir o mesmo massivo duas vezes
- `messages(channel_message_id)` único, porque o webhook chega repetido

## API

### Entrada de mensagens

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `POST /webhooks/chatmix` | recebe mensagem do Chat Mix, decide se o agente atende (fora do horário ou massivo) e responde | Chat Mix (assinatura/token) | evento do Chat Mix (formato a confirmar) | 200 imediato; processamento na fila | F00–F04 |
| `GET/POST /webhooks/meta` | mesma coisa direto da Meta (alternativa e testes) | Meta (verify token + X-Hub-Signature-256) | payload da Cloud API | 200 | F00–F04 |

### Ferramentas do agente (tool use, chamadas pelo Claude)

| tool | does | flow |
| --- | --- | --- |
| `identificar_cliente(cpf_ou_telefone)` | acha o cliente no SGP | todos |
| `status_conexao(cliente_id)` | online/offline, suspenso, área (POP/OLT/PON) | F01 |
| `incidente_na_area(cliente_id)` | se há massivo aberto na área dele, com a mensagem e a previsão | F00, F01 |
| `faturas_em_aberto(cliente_id)` | lista de faturas | F02 |
| `enviar_segunda_via(fatura_id)` | link do boleto e PIX copia-e-cola | F02 |
| `desbloqueio_confianca(cliente_id)` | pede o desbloqueio, respeitando a regra do SGP | F02 |
| `verificar_cobertura(cep, numero)` | se há cobertura no endereço | F03 |
| `registrar_pendencia(tipo, prioridade, resumo, dados)` | cria item na fila da manhã (e o chamado no SGP quando for técnico) | F01, F03, F04 |
| `consultar_base(pergunta)` | busca na base de conhecimento | todos |

Todas validam a entrada (zod, `strict: true`) e nunca deixam o modelo escolher dados de outro cliente: o `cliente_id` vem da identificação feita na própria conversa.

### Painel (sessão logada)

| method path | does | who | flow |
| --- | --- | --- | --- |
| `GET /painel` | fila da manhã + incidentes abertos + números do dia | atendente | F05 |
| `POST /incidentes` | abrir incidente manual (área, mensagem, previsão) | atendente | F00 |
| `PATCH /incidentes/:id` | atualizar previsão (avisa quem chamou) ou encerrar | atendente | F00 |
| `PATCH /pendencias/:id` | marcar como feito | atendente | F05 |
| `GET/PUT /config/horarios` | horário humano e feriados | admin | – |
| `GET/POST/PUT /base` | base de conhecimento | admin | – |
| `GET /conversas/:id` | histórico completo | atendente | F05 |

Webhooks in: Chat Mix (ou Meta). Webhooks out: nenhum. Envio pelo `ChannelGateway`.

### Jobs

| job | quando | faz |
| --- | --- | --- |
| `varredura_sgp` | a cada 2 min | lê online/offline e grava o snapshot. Se mais de X% (ou mais de N clientes) de uma área caem em até 5 min, abre um incidente "suspeito" e avisa a equipe |
| `normalizacao_incidente` | a cada 2 min durante incidente | quando a área volta, avisa quem chamou e reabre como chamado individual quem continua offline após 15 min |
| `envio_com_retry` | fila | reenvia mensagens que falharam (backoff), sem duplicar |
| `resumo_da_manha` | 7h50 nos dias úteis | manda à equipe o resumo da noite (no painel e, se quiser, no grupo da equipe) |
| `retencao_lgpd` | diário | apaga histórico mais antigo que o prazo configurado |

## Mídia: como o agente "vê" e "ouve"

- **Foto da ONU:** o modelo recebe a imagem com um guia de referência (quais luzes, quais cores) e responde num formato estruturado: `{led_los: vermelho|apagado|incerto, led_pon: ..., confianca}`. Se a confiança for baixa, pede outra foto ("chega mais perto da luz escrita LOS"). Nunca afirma LOS sem ver.
- **Vídeo:** quadros a cada ~1s (máx. 8), para pegar luz piscando, que uma foto sozinha não mostra.
- **Áudio:** transcrição em pt-BR; o agente responde ao conteúdo, e a transcrição fica no histórico para a equipe.
- **Limites:** vídeo até ~60s, arquivos apagados da VPS após processar (LGPD); só a análise fica gravada.

## The parts that bite

- **Fuso e horário:** tudo em UTC no banco; "está no horário humano?" é calculado em `America/Sao_Paulo`. Sábado às 12h e feriados vêm da config.
- **Idempotência:** Chat Mix e Meta reenviam webhooks. Cada mensagem tem id único, e a resposta só sai uma vez.
- **Corrida:** cliente manda 3 mensagens seguidas. A conversa fica travada por contato (lock na fila) e as mensagens são juntadas por ~3s antes de chamar a IA.
- **Massivo = rajada:** 140 conversas em minutos. Quem está em área com incidente recebe a mensagem pronta do incidente **sem chamar a IA**; só quem pergunta outra coisa vai para o modelo. Fila com concorrência limitada para não estourar os rate limits da Anthropic, do SGP e do Chat Mix.
- **Falso massivo:** queda de energia num bairro parece rompimento. O incidente automático nasce como "suspeito" e a mensagem só fala do que é certo ("identificamos instabilidade na sua região"). A equipe confirma ou edita.
- **Passagem para o horário humano:** às 8h, conversas abertas com a IA ficam marcadas no Chat Mix para a equipe assumir. A IA para de responder em conversa que um humano assumiu.
- **Janela de 24h da Meta:** respostas e avisos de normalização a quem chamou nas últimas 24h são grátis. Fora disso só com template aprovado (não está no escopo da fase 1).
- **Segurança da IA:** o agente não cita preço, prazo ou promoção fora da base de conhecimento, não promete técnico em horário, e com dúvida registra pendência. Texto do cliente nunca vira instrução de sistema.
- **LGPD:** CPF e histórico só na VPS, acesso por papel, retenção e exclusão por pedido.
- **Dependências externas a confirmar:** API do Chat Mix e endpoints do SGP. São os dois maiores riscos.

## Custos (decisão do usuário)

Só a API da Anthropic é custo novo; a conta é paga por uso, com crédito pré-pago. O modelo é escolhido por rota em config e pode ser trocado sem mexer no código:

| modelo | uso sugerido | custo por conversa (est.) |
| --- | --- | --- |
| Opus 5.5 | qualidade máxima | ~R$ 1,40 |
| Sonnet 5.5 | pré-venda | ~R$ 0,70 |
| Haiku 5.5 | suporte e boleto | ~R$ 0,04 |

Com ~600 conversas/mês: Haiku no suporte + Sonnet nas vendas ≈ R$ 50–100/mês; tudo no Sonnet (foco em conversa humanizada e visão) ≈ R$ 400–500/mês; mais a transcrição de áudio (grátis com Whisper na VPS, ou centavos por minuto num serviço externo). O piloto mede o custo real e a qualidade antes de fixar.

## Build order

1. **Fatia vertical (semana 1):** webhook da Meta num número de teste → horário humano? → agente com `identificar_cliente`, `status_conexao`, `faturas_em_aberto`, `enviar_segunda_via` → resposta no WhatsApp → conversa gravada. Tabelas: contacts, conversations, messages, business_hours. Prova a stack de ponta a ponta.
2. **Integração Chat Mix (semana 1–2, depende deles):** `ChannelGateway` do Chat Mix, passagem para a equipe às 8h.
3. **Must-haves (semana 2–3):** roteiro completo de "sem internet" (online/offline, luzes da ONU, reinício), desbloqueio, pré-venda sem agendar, `registrar_pendencia` e fila da manhã (S03/painel), base de conhecimento, login e papéis, LGPD.
4. **Modo massivo (semana 3–4):** varredura do SGP, incidentes (manual primeiro, automático depois), resposta sem IA, atualização de previsão, aviso de normalização.
5. **Mídia (dentro das semanas 2–3, é must):** foto e vídeo das luzes da ONU, áudio. **Should-haves:** métricas.
6. **Piloto:** uma semana só em noites e domingo, com a equipe revisando todas as conversas de manhã; ajuste de prompts, base e modelos.
