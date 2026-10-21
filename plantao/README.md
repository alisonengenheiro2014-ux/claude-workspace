# Plantão Maxgiga

Agente de atendimento no WhatsApp para provedor de internet. Atende fora do horário da equipe e em quedas em massa (massivo), entende texto, áudio, foto e vídeo, consulta o SGP e deixa pendências organizadas para a equipe.

Planejamento completo em `../replica/` (`recon.md`, `architecture.md`, `features.csv`).

## O que já funciona (semanas 1 a 3)

- **Quando atende:** fora do horário humano (seg–sex 8h–21h, sáb 8h–12h; domingo e feriado sem equipe) e, **em massivo, 24h**.
- **Massivo:** cliente de área com incidente aberto recebe na hora a mensagem do incidente, **sem chamar a IA**, e fica vinculado à ocorrência.
- **Agente (Claude) com ferramentas:** identificar cliente (telefone ou CPF), status online/offline, massivo na região, faturas, segunda via (boleto e PIX), cobertura, registrar pendência/chamado e base de conhecimento.
- **Roteiro de "sem internet":** online = problema de Wi-Fi; offline = pede foto/vídeo da ONU; LOS vermelho = chamado prioritário sem mandar reiniciar; senão, reinício guiado e conferência no SGP.
- **Áudio:** transcrito (servidor Whisper local) e respondido como texto.
- **Foto e vídeo da ONU:** leitura das luzes POWER/PON/LOS com resposta estruturada; vídeo vira até 8 quadros para pegar luz piscando. Arquivos não ficam guardados.
- **Painel da equipe** (`/painel`): login com papéis (admin e atendente), fila da manhã por prioridade com "ver conversa" e "feito", números das últimas 24h, abrir massivo por área, atualizar a previsão e encerrar avisando automaticamente quem chamou nas últimas 24h, horários e feriados editáveis, base de conhecimento editável (o agente só usa o que estiver lá). Funciona no celular, com tema claro e escuro.
- **Massivo automático:** a cada 2 minutos o sistema lê o status de todos os clientes no SGP. Se pelo menos 3 clientes da mesma PON caem em 10 minutos e 60% da área fica offline, abre um massivo "suspeito" sozinho (a equipe confirma ou descarta no painel). Sobe para OLT ou POP só quando duas ou mais áreas abaixo caíram. Quando 90% da área volta (e o massivo tem pelo menos 5 minutos), encerra, avisa quem chamou e cria chamado para quem continua offline. Tudo ajustável no `.env`.
- **Manutenção:** conversa parada há 12h é encerrada (a próxima mensagem abre um atendimento novo); histórico com mais de 180 dias é apagado (LGPD).
- **Liberação só após o pagamento:** a assistente nunca libera nem promete liberar; manda a segunda via e, se o cliente já pagou ou mandou comprovante, registra "conferir pagamento" para a equipe. O desbloqueio de confiança fica desligado (`DESBLOQUEIO_CONFIANCA=false`).
- **Fim do massivo:** ao normalizar, a assistente pergunta a quem chamou se a internet voltou. Quem confirma recebe um agradecimento e o atendimento é encerrado; quem não responde em 30 minutos (`DESPEDIDA_MINUTOS`) recebe uma despedida e o atendimento é encerrado.
- **Robustez:** webhook repetido não gera resposta dupla, mensagens do mesmo cliente são atendidas em ordem, assinatura da Meta conferida, uma conversa aberta por cliente.

## Ainda falta

| item | depende de |
| --- | --- |
| integração com o Chat Mix | documentação da API do Chat Mix |
| SGP real: cliente já escrito, falta testar com o SGP da Maxgiga | `SGP_APP` e `SGP_TOKEN` (Administração > Integrações > Tokens) |
| passagem da conversa para a equipe às 8h | integração com o Chat Mix |

## Rodar

```bash
npm install
npm test                 # 78 testes (6 precisam de Postgres)
npm run typecheck

# conversar com o agente no terminal (SGP simulado, sempre "fora do horário")
ANTHROPIC_API_KEY=sk-ant-... npm run simular
#   /foto caminho.jpg   /video caminho.mp4   /audio caminho.ogg   /massivo PON-2/1   /pendencias   /sair
```

Teste com Postgres real: `TEST_DATABASE_URL=postgres://... npm test` (o teste apaga o schema `public` desse banco: use um banco descartável).

## Ligar o SGP real

1. No SGP: Administração > Integrações > Tokens, crie um app (ex.: `plantao`) e copie o token.
2. No `.env`: `SGP_MODO=http`, `SGP_BASE_URL`, `SGP_APP`, `SGP_TOKEN`.
3. Teste só com consultas: `npm run testar-sgp -- --cpf CPF_DE_UM_CLIENTE`.

Rotas usadas (POST com `app` e `token` no corpo): `/api/ura/consultacliente/`, `/api/ura/clientes/` (busca por telefone), `/api/ura/titulos/`, `/api/ura/liberacaopromessa/`, `/api/ura/chamado/`; e `GET /api/fttx/onu/list/` para sinal da ONU, OLT e PON. O status online/offline vem do sinal da ONU (abaixo de `SGP_SINAL_MINIMO_DBM` = sem conexão). A viabilidade de endereço não tem rota conhecida: o agente registra como pré-venda e a equipe confirma.

## Subir na VPS

Pré-requisitos: Docker na VPS e um subdomínio (ex.: `plantao.maxgiga.com.br`) apontado para o IP dela.

```bash
git clone <este repositório> && cd claude-workspace/plantao
bash instalar.sh
```

O instalador pergunta o subdomínio, a chave da Anthropic, o SGP e a Meta (o que não tiver, pule com Enter), gera as senhas, sobe tudo com HTTPS e cria o seu usuário de administrador. No fim, mostra o endereço do painel e o que colar na configuração do webhook da Meta. Use **um número de teste** enquanto o Chat Mix não estiver integrado.

## Avaliar a IA antes de ligar

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run avaliar               # 15 situações reais de atendimento
npm run avaliar -- --modelo claude-sonnet-5-5               # comparar com outro modelo
npm run avaliar -- --cenario los-vermelho --detalhes        # um cenário, mostrando as respostas
```

Cada cenário (LOS vermelho, Wi-Fi lento, bloqueado, "já paguei", quer contratar, preço sem cadastro, Procon, tentativa de enganar a IA, áudio...) é conferido por regras objetivas: quais ferramentas a IA usou, que pendência registrou e o que disse ou deixou de dizer. Mostra também o custo médio por conversa.

## Modelos de IA

Configuráveis no `.env`: `MODEL_CONVERSA` (padrão `claude-haiku-5-5`, mais barato) e `MODEL_VISAO` (padrão `claude-sonnet-5-5`, só para foto/vídeo). A análise de imagem usa o fallback automático do servidor da Anthropic caso um modelo recuse.
