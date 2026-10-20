# Recon map: Maestro AI (agente de IA no WhatsApp + CRM próprio)

Scope: o ciclo principal (o agente atende no WhatsApp, qualifica, agenda e faz follow-up) e o CRM em funil que recebe cada conversa. Adaptado ao atendimento de um provedor de internet.
For: Maxgiga (provedor de internet), uso interno no atendimento e nas vendas.
Date: 2026-10-20

> **Confiança: MÉDIA.** O site público foi mapeado inteiro pelas 8 fotos enviadas pelo usuário (`screens/site-01..08.jpg`). O painel interno do CRM só aparece numa ilustração do funil (site-05). As outras telas internas são inferidas e estão marcadas assim.

## O que o Maestro AI é de verdade

Não é um SaaS de autoatendimento. É uma **agência de automação** que monta um agente sob medida para cada cliente (foco em clínicas de saúde e estética, mas também atende imobiliárias e franquias) e entrega junto um **CRM próprio**. O processo comercial tem 4 etapas: entender o negócio, construir o agente, integrar com WhatsApp, agenda e sistema de gestão, e acompanhar e otimizar todo mês. A venda começa com uma demonstração gratuita.

Para a Maxgiga isso significa que não existe um "app" para copiar tela por tela. O que dá para reconstruir é **o agente mais o CRM**. Esse é o produto.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (fotos do usuário) | https://maestroia.com.br/ | seções: hero, problema, solução, como funciona, diferencial, Maestro CRM, por que, resultados, FAQ, formulário de demonstração. screens/site-01..08 |
| 2 | ilustração do funil do CRM | https://maestroia.com.br/ (seção Maestro CRM) | colunas e badges dos cards. screens/site-05 |
| 3 | central de ajuda, preços, changelog, lojas de apps | n/a | não existem publicamente. O preço fica dentro do FAQ "Quanto custa?" (fechado) |
| 4 | conta do usuário | n/a | não tem |

Daqui o domínio não resolve no DNS, por isso as fotos são a fonte.

## Core loop

O contato chega no WhatsApp, a IA responde em segundos (24/7), faz poucas perguntas para qualificar, oferece horários reais e agenda. Se o contato some, a IA retoma depois. Cada conversa vira automaticamente um card no funil do CRM, com o histórico e a indicação de quem está atendendo (IA ou equipe).

## Capacidades declaradas no site

| # | capacidade | evidência |
| --- | --- | --- |
| C1 | resposta em segundos, 24/7 | site-01, site-03 |
| C2 | qualificação (separa o curioso de quem quer comprar) | site-03 |
| C3 | agendamento dentro da conversa com horários reais, confirmação e lembretes | site-01 (exemplo de chat), site-03, site-04 |
| C4 | follow-up automático de quem some | site-03 |
| C5 | tom de voz do negócio e passagem para humano na hora certa | site-03 |
| C6 | escala (centenas de contatos simultâneos) | site-03 |
| C7 | integra com WhatsApp oficial, agenda e sistema de gestão | site-04, site-06 |
| C8 | conhecimento, regras e tom 100% configuráveis | site-04 |
| CRM1 | todo contato cai no CRM sozinho, com o histórico completo da conversa | site-05 |
| CRM2 | registra quando a IA começou e terminou cada atendimento | site-05 |
| CRM3 | campos personalizados por segmento (procedimento, origem...) | site-05 |
| CRM4 | funil visual com arrastar entre etapas, ganho/perdido com motivo | site-05 |
| CRM5 | NPS por etapa da jornada | site-05 |
| CRM6 | relatórios: origem dos contatos, quem atende melhor, onde se perde | site-05 |
| S1 | acesso por papel, dados isolados por empresa, LGPD | site-06 |
| M1 | métricas mostradas: tempo de resposta, % respondidos, agendamentos, recuperados por follow-up | site-07 |

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Conversa no WhatsApp (lado do cliente) | WhatsApp da empresa | o agente atende, qualifica, oferece horários | bolhas, digitando, horários sugeridos | visto (site-01) |
| S02 | Funil do CRM (kanban) | painel /funil | ver cada contato na sua etapa | colunas, cards com nome, origem, interesse, badges de status | visto em ilustração (site-05): colunas Novo contato, Qualificado, Agendado. Badges: IA atendendo, follow-up em N dias, agendado pela IA, IA finalizou / equipe |
| S03 | Ficha do contato | clique no card | dados, campos personalizados, histórico completo da conversa, linha do tempo da IA | painel de campos, transcrição, eventos | inferido (site-05) |
| S04 | Relatórios | painel /relatorios | origem, conversão por etapa, perdas com motivo, desempenho por atendente, NPS | gráficos, filtros de período | inferido (site-05, site-07) |
| S05 | NPS | painel /nps | satisfação por etapa | score, respostas | inferido (site-05) |
| S06 | Usuários e papéis | painel /equipe | acesso controlado por papel | tabela, convite | inferido (site-06) |
| S07 | Configuração do agente | interno da agência | conhecimento, regras, tom, roteiro de agendamento | n/a | inferido: no Maestro quem configura é a agência. Na Maxgiga será uma tela própria |
| S08 | Landing + formulário de demonstração | site público | captar interessados | hero, seções, FAQ em acordeão, formulário (nome, WhatsApp, empresa), botão flutuante do WhatsApp | visto (site-01..08) |

## Flows (adaptados à Maxgiga)

```
F01 Interessado contrata internet          (equivale a "qualifica e agenda avaliação")
    S01: pergunta -> IA pede endereço/CEP -> checa cobertura -> 2 perguntas de perfil (uso, quantas pessoas) -> sugere plano -> oferece 2 horários de instalação -> confirma
    S02: card nasce em "Novo contato" -> "Qualificado" -> "Instalação agendada" (badge: agendado pela IA)
    happy path: ~5 mensagens do cliente (no exemplo do site são 3 até os horários)
    edge: sem cobertura (lista de espera), CPF com pendência, nenhum horário serve, pergunta fora do roteiro

F02 Follow-up de quem sumiu
    contato parou de responder -> badge "follow-up em N dias" -> IA retoma -> volta ao fluxo ou é marcado perdido com motivo

F03 Cliente com problema técnico               (novo, específico de provedor)
    S01: identifica por CPF no SGP -> checa falha massiva na região -> diagnóstico guiado -> abre chamado -> agenda visita

F04 Segunda via e desbloqueio                  (novo, específico de provedor)
    S01: CPF -> faturas no SGP -> boleto/PIX -> desbloqueio de confiança se permitido

F05 Passagem para humano
    IA detecta pedido, irritação ou caso fora do escopo -> badge "IA finalizou / equipe" -> atendente assume com o histórico em S03

F06 Gestor acompanha
    S02 / S04: onde o funil perde, de onde vêm os contatos, NPS por etapa
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Kanban column | uma por etapa | vazia, com contagem | S02 |
| Lead card | por origem | badges: IA atendendo, follow-up agendado, agendado pela IA, IA finalizou / equipe | S02 |
| Status badge | azul (IA), amarelo (follow-up), verde (agendado), neutro (equipe) | | S02, S03 |
| Chat transcript | cliente, IA, humano | | S03 |
| Custom field | texto, seleção, data | | S03 |
| Stat tile | número grande + legenda | | S04, S08 |
| FAQ accordion | | fechado, aberto | S08 |
| Lead form | nome, WhatsApp, empresa | vazio, erro, enviado | S08 |
| Floating WhatsApp button | | | S08 |

## Inferred data model

```
Tenant        id, name                               evidence: "dados isolados por empresa" (site-06); confidence: high. Para a Maxgiga é um tenant só
Contact       id, tenant_id, phone, name, origin (instagram|indicacao|anuncio|...), custom_fields (json), stage_id, outcome (aberto|ganho|perdido), lost_reason?
              evidence: cards e texto do CRM (site-05); confidence: high. Para provedor: cpf, sgp_customer_id, endereco, plano_interesse
Stage         id, tenant_id, name, position          evidence: colunas do funil (site-05); confidence: high
Conversation  id, contact_id, handled_by (ia|equipe), ai_started_at, ai_finished_at, assigned_user_id?
              evidence: "registra quando o agente iniciou e finalizou" + badges (site-05); confidence: high
Message       id, conversation_id, author (cliente|ia|humano), body, sent_at        evidence: "histórico completo" (site-05); confidence: high
FollowUp      id, contact_id, due_at, attempt, status   evidence: badge "follow-up em 2 dias" (site-05); confidence: medium
Appointment   id, contact_id, start_at, kind, status, reminder_sent   evidence: chat de exemplo + lembretes (site-01, site-03); confidence: high
NpsResponse   id, contact_id, stage, score, comment  evidence: "NPS por etapa" (site-05); confidence: medium
StageChange   id, contact_id, from_stage, to_stage, by (ia|user), at   evidence: "fica registrado com motivo" (site-05); confidence: medium
User          id, tenant_id, name, role              evidence: "acesso controlado por papel" (site-06); confidence: medium
AgentConfig   id, tenant_id, tone, knowledge, rules, schedule   evidence: site-04; confidence: medium
```

Relationships: Tenant 1-n Contact/Stage/User. Contact 1-n Conversation, Appointment, FollowUp, NpsResponse, StageChange. Conversation 1-n Message.

## Feature matrix

See `features.csv`. Must: 16, should: 10, could: 5, skip: 3.

## Out of scope (cannot or should not be cloned)

- Marca, nome, logo, textos e números do site do Maestro AI. As métricas de "resultados" são deles e não podem ser usadas como nossas.
- O serviço de agência (consultoria mensal). Na Maxgiga quem faz esse papel é a própria equipe.
- Campos e roteiros de clínica (procedimentos, médico). Trocados por plano, cobertura e chamado.

## Size

Screens 8 (6 do painel), flows 6, entities 11. Hard parts:
1. WhatsApp Business API oficial (conta na Meta ou num BSP, templates aprovados para follow-up e lembretes fora da janela de 24h).
2. Agente de IA confiável: roteiro de qualificação, uso de ferramentas (SGP, agenda), passagem para humano, sem inventar preço ou prazo.
3. Integração com o SGP para cliente, faturas, desbloqueio e chamados (já existe em parte via MCP), e agenda de instalação e técnicos.

Size: **M**. Umas 3 a 5 semanas para o agente com F01, F02 e F05 mais o funil do CRM. F03, F04, relatórios e NPS ficam para uma segunda fase.
