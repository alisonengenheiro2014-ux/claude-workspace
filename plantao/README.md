# Plantão Maxgiga

Agente de atendimento no WhatsApp para provedor de internet. Atende fora do horário da equipe e em quedas em massa (massivo), entende texto, áudio, foto e vídeo, consulta o SGP e deixa pendências organizadas para a equipe.

Planejamento completo em `../replica/` (`recon.md`, `architecture.md`, `features.csv`).

## O que já funciona (semanas 1 e 2)

- **Quando atende:** fora do horário humano (seg–sex 8h–21h, sáb 8h–12h; domingo e feriado sem equipe) e, **em massivo, 24h**.
- **Massivo:** cliente de área com incidente aberto recebe na hora a mensagem do incidente, **sem chamar a IA**, e fica vinculado à ocorrência.
- **Agente (Claude) com ferramentas:** identificar cliente (telefone ou CPF), status online/offline, massivo na região, faturas, segunda via (boleto e PIX), desbloqueio de confiança, cobertura, registrar pendência/chamado e base de conhecimento.
- **Roteiro de "sem internet":** online = problema de Wi-Fi; offline = pede foto/vídeo da ONU; LOS vermelho = chamado prioritário sem mandar reiniciar; senão, reinício guiado e conferência no SGP.
- **Áudio:** transcrito (servidor Whisper local) e respondido como texto.
- **Foto e vídeo da ONU:** leitura das luzes POWER/PON/LOS com resposta estruturada; vídeo vira até 8 quadros para pegar luz piscando. Arquivos não ficam guardados.
- **Painel da equipe** (`/painel`): login com papéis (admin e atendente), fila da manhã por prioridade com "ver conversa" e "feito", números das últimas 24h, abrir massivo por área, atualizar a previsão e encerrar avisando automaticamente quem chamou nas últimas 24h, horários e feriados editáveis, base de conhecimento editável (o agente só usa o que estiver lá). Funciona no celular, com tema claro e escuro.
- **Robustez:** webhook repetido não gera resposta dupla, mensagens do mesmo cliente são atendidas em ordem, assinatura da Meta conferida, uma conversa aberta por cliente.

## Ainda falta

| item | depende de |
| --- | --- |
| integração com o Chat Mix | documentação da API do Chat Mix |
| SGP real (hoje usa dados simulados) | token e documentação da API do SGP |
| detecção automática de massivo pela varredura do SGP | semana 3–4 |
| passagem para a equipe às 8h, resumo da manhã, retenção LGPD | semana 3–4 |

## Rodar

```bash
npm install
npm test                 # 42 testes (4 precisam de Postgres)
npm run typecheck

# conversar com o agente no terminal (SGP simulado, sempre "fora do horário")
ANTHROPIC_API_KEY=sk-ant-... npm run simular
#   /foto caminho.jpg   /video caminho.mp4   /audio caminho.ogg   /massivo PON-2/1   /pendencias   /sair
```

Teste com Postgres real: `TEST_DATABASE_URL=postgres://... npm test` (o teste apaga o schema `public` desse banco: use um banco descartável).

## Subir na VPS

1. Copie `.env.example` para `.env` e preencha (senha do banco, chave da Anthropic, dados do app da Meta).
2. Aponte um subdomínio para a VPS e coloque-o no `Caddyfile`.
3. `docker compose up -d --build` (as migrations rodam sozinhas ao iniciar).
4. Crie o primeiro usuário: `docker compose exec app node dist/criar-usuario.js --nome "Seu Nome" --email voce@maxgiga.com.br --papel admin` e acesse `https://SEU-SUBDOMINIO/painel`.
5. No app da Meta, configure o webhook `https://SEU-SUBDOMINIO/webhooks/meta` com o `META_VERIFY_TOKEN`, de preferência num **número de teste**, enquanto o Chat Mix não está integrado.

## Modelos de IA

Configuráveis no `.env`: `MODEL_CONVERSA` (padrão `claude-haiku-5-5`, mais barato) e `MODEL_VISAO` (padrão `claude-sonnet-5-5`, só para foto/vídeo). A análise de imagem usa o fallback automático do servidor da Anthropic caso um modelo recuse.
