# Recon map: Maestro AI (web, agente em WhatsApp)

Scope: o ciclo principal. Um agente de IA atende o contato na hora, entende o que ele quer, qualifica e agenda, conectado ao sistema de gestão. Adaptado ao atendimento de um provedor de internet.
For: Maxgiga (provedor de internet), uso interno no atendimento ao cliente. Não é um produto para revender.
Date: 2026-10-20

> **Confiança: BAIXA.** Este mapa é provisório. `maestroia.com.br` não resolve no DNS a partir deste ambiente (nem curl nem WebFetch). A única fonte foi o resumo do site num índice de busca. Telas, fluxos e modelo de dados são **inferências** feitas a partir desse resumo e do caso de uso de um provedor. Para subir a confiança, precisamos de prints do site, da demonstração ou da sua conta (ficam em `replica/screens/`).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | site (via índice de busca) | https://maestroia.com.br/ | agente de IA para clínicas: responde leads na hora, qualifica, agenda avaliação, integra com a agenda e o sistema de gestão da clínica, oferece demonstração grátis |
| 2 | possível empresa relacionada (não confirmada) | https://www.maestrotecnologia.com.br/ | diz que monta agentes de IA sobre n8n, Make e OpenAI. Também não abriu daqui |
| 3 | conta do usuário | n/a | ainda não temos |
| 4 | central de ajuda, preços, changelog | n/a | não encontrados |

Termos: não lidos, porque o site não abre. Se você tiver conta, confira se os termos proíbem usá-la para construir algo concorrente. Para uso interno de atendimento da Maxgiga o risco é baixo, mas continuamos só com fontes públicas e com o que você mostrar.

## Core loop

O cliente manda mensagem no WhatsApp, a IA responde na hora, identifica o cliente e o assunto, resolve sozinha consultando o sistema de gestão (no caso da Maxgiga, o SGP) ou agenda um atendimento, e passa para um humano quando precisa.

## Screens

O agente vive no WhatsApp. As telas abaixo são do painel da equipe (inferidas, nível *guess*).

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Login | /login | entrada da equipe | form, botão | inferido |
| S02 | Painel (visão geral) | / | volume de atendimentos, % resolvidos pela IA, tempo de resposta, agendamentos | stat tiles, gráfico, filtro de período | inferido |
| S03 | Caixa de conversas | /conversas | lista de conversas ativas, com status (IA / humano / aguardando) | lista, busca, filtros, badges | inferido |
| S04 | Conversa | /conversas/:id | histórico, dados do cliente ao lado, assumir/devolver para a IA | chat, painel lateral do cliente, botões de ação | inferido |
| S05 | Contatos / leads | /contatos | leads e clientes, etapa, origem | tabela, filtros, tags | inferido |
| S06 | Agenda | /agenda | visitas técnicas e instalações agendadas | calendário, slots, modal | inferido |
| S07 | Configurar agente | /agente | tom de voz, base de conhecimento, regras de transbordo, horário | form, editor de texto, toggles | inferido |
| S08 | Base de conhecimento | /agente/conhecimento | planos, preços, FAQ, áreas de cobertura | lista, upload, editor | inferido |
| S09 | Integrações | /integracoes | WhatsApp, agenda, sistema de gestão (SGP) | cards de conexão, status | inferido |
| S10 | Equipe e permissões | /equipe | atendentes, papéis | tabela, convite | inferido |
| S11 | Demonstração / landing | site público | captar interessados | hero, CTA, form | visto (resumo) |

## Flows

Flows adaptados ao provedor (F01 e F02 equivalem ao "qualifica e agenda" do original).

```
F01 Novo interessado contrata internet
    WhatsApp -> IA pergunta endereço/CEP -> consulta cobertura -> apresenta planos -> coleta dados -> agenda instalação (S06) -> confirmação
    happy path: ~6 mensagens do cliente
    edge: sem cobertura (entra na lista de espera), CPF com pendência, horário indisponível, cliente some no meio

F02 Cliente pede visita técnica
    WhatsApp -> IA identifica por CPF -> diagnóstico guiado (luzes da ONU, reinício) -> abre chamado no SGP -> agenda visita (S06)
    edge: falha massiva na região (avisar em vez de abrir chamado), cliente suspenso

F03 Segunda via e desbloqueio
    WhatsApp -> CPF -> consulta faturas no SGP -> envia boleto/PIX -> oferece desbloqueio de confiança
    edge: desbloqueio já usado no mês, mais de uma fatura em aberto

F04 Transbordo para humano
    IA detecta pedido, irritação ou assunto fora do escopo -> conversa entra em S03 como "aguardando" -> atendente assume em S04 -> devolve para a IA

F05 Gestor ajusta o agente
    S07 -> edita regras/conhecimento (S08) -> testa -> publica

F06 Gestor acompanha resultados
    S02 -> filtra período -> abre conversa (S04)
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, hover, focus, disabled, loading | all |
| Chat bubble | cliente, IA, humano, sistema | enviado, entregue, lido, erro | S04 |
| Conversation list item | IA, humano, aguardando, encerrada | não lida, selecionada | S03 |
| Customer side panel | lead, cliente ativo, suspenso | carregando, erro do SGP | S04 |
| Stat tile | número, % com variação | carregando, vazio | S02 |
| Calendar / slot picker | dia, semana | livre, ocupado, bloqueado | S06 |
| Data table | com filtros e paginação | vazio, carregando, filtrado | S05, S10 |
| Integration card | conectado, desconectado, erro | | S09 |
| Toast | sucesso, erro | | all |

## Inferred data model

```
Contact       id, phone, name, cpf?, sgp_customer_id?, kind (lead|cliente), stage, tags
              evidence: resumo do site ("qualifica leads") + caso provedor; confidence: medium
Conversation  id, contact_id, channel (whatsapp), status (ia|humano|aguardando|encerrada), assigned_to?, intent, started_at, closed_at
              evidence: inferido; confidence: guess
Message       id, conversation_id, author (cliente|ia|humano|sistema), body, media?, sent_at, delivery_status
              confidence: guess
Appointment   id, contact_id, kind (instalacao|visita_tecnica), start_at, end_at, technician_id?, status, sgp_ticket_id?
              evidence: "agenda avaliações" (resumo); confidence: medium
Ticket        id, contact_id, sgp_ticket_id, motivo, status
              confidence: guess (específico de provedor)
AgentConfig   id, tone, business_hours, handoff_rules (json), knowledge_items[]
              confidence: guess
KnowledgeItem id, title, body, kind (plano|faq|cobertura)
              confidence: guess
User          id, name, email, role (admin|atendente)
              confidence: guess
```

Relationships: Contact 1-n Conversation, Conversation 1-n Message, Contact 1-n Appointment, Contact 1-n Ticket, User 1-n Conversation (assigned).

## Feature matrix

See `features.csv`. Must: 13, should: 9, could: 5, skip: 2.

## Out of scope (cannot or should not be cloned)

- Marca, nome, textos, layout e prompts do Maestro AI.
- Integrações específicas de clínicas (prontuário, agenda médica). Trocadas pelo SGP.
- A carteira de clientes e os dados deles.

## Size

Screens 11, flows 6, entities 8. Hard parts: integração oficial com a WhatsApp Business API (Meta/BSP), integração com o SGP (chamados, faturas, desbloqueio; parte já existe via MCP), o agente de IA com regras confiáveis de transbordo, e a agenda de técnicos. Size: **M** (algumas semanas) para o ciclo principal: F01 a F04 mais o painel básico.
