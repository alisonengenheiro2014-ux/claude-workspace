# Architecture: editor de vídeo pessoal (refaz o essencial do app CapCut)

Lê `replica/recon.md` e `replica/features.csv`. Nome provisório até o
`/replica-brand`.

O clone é um PWA instalado na tela de início de um iPhone 18 Pro Max, usado
por uma pessoa só. Por isso **não há servidor, banco na nuvem, login,
cobrança nem e-mail**. Todo o trabalho acontece no aparelho: guardar,
decodificar, compor, codificar. A única chamada externa possível é a
transcrição das legendas, se você escolher usar uma API em vez do modelo
local.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Vite + React + TypeScript | build estático, sem servidor; React é o padrão mais documentado para uma UI cheia de painéis |
| estado | Zustand + Immer | o documento do projeto é uma árvore editada o tempo todo; Immer gera patches que viram desfazer/refazer de graça |
| styling | Tailwind, com os tokens do `/replica-design` | |
| PWA | vite-plugin-pwa (Workbox) | manifest, ícones e service worker para abrir offline |
| banco local | IndexedDB via Dexie | projetos, metadados e histórico; transações e índices sem escrever IndexedDB na mão |
| arquivos | OPFS (Origin Private File System), escrito num Web Worker | os vídeos importados são grandes demais para o IndexedDB; o OPFS lê e grava por partes |
| decodificar / codificar | WebCodecs (`VideoDecoder`, `VideoEncoder`, `AudioDecoder`, `AudioEncoder`) | completo no Safari a partir do iOS 26; usa o hardware do iPhone |
| ler e gravar MP4 | Mediabunny | lê MP4/MOV do iPhone (demux), grava MP4 (mux); TypeScript, sem dependências, feito para WebCodecs |
| composição | WebGL2 (shaders próprios) num `OffscreenCanvas` | filtros, ajustes, chroma key, máscara, mistura e transições num só passe por quadro, na GPU |
| texto | Canvas 2D desenhando numa textura | fontes abertas carregadas com `FontFace`; vira uma camada na composição |
| áudio | Web Audio (`AudioContext` na prévia, `OfflineAudioContext` na exportação) | mixagem, volume, fade e velocidade com o mesmo grafo nas duas pontas |
| legendas | Whisper no aparelho via transformers.js (WebGPU); alternativa: API de transcrição com a sua chave | o local é grátis e privado, mas é pesado; a API é rápida, mas paga |
| hospedagem | Cloudflare Pages ou Vercel (site estático) | o PWA precisa de HTTPS; nada roda do lado do servidor |
| testes | Vitest (lógica da linha do tempo) + Playwright (fluxos) + teste manual no iPhone | o Safari do iPhone é o único alvo que vale; Playwright WebKit não substitui o aparelho |

Uma página, um worker de mídia, um worker de exportação. Sem backend.

## Schema

Tabelas (stores do IndexedDB): 6. Regras de acesso: nenhuma. O app tem um
usuário só e os dados nunca saem do aparelho, então não há coluna de dono nem
checagem de permissão. O navegador já isola o armazenamento por site.

Diferença em relação ao modelo de dados do recon: a linha do tempo (faixas,
clipes, keyframes, transições, legendas) é guardada como **um documento JSON
por projeto**, não espalhada em tabelas. O editor sempre carrega, edita e
salva o projeto inteiro de uma vez. O desfazer funciona sobre esse documento.
Separar em seis tabelas só traria joins e salvamentos pela metade.

As regras de SQL viram regras deste banco:

- `id` é `crypto.randomUUID()`, e todo registro tem `createdAt` e `updatedAt`.
- Horários são números em milissegundos UTC (`Date.now()`). Tempos dentro do
  vídeo são inteiros em microssegundos, a mesma unidade do WebCodecs, para
  não acumular erro de arredondamento.
- Exclusões em cascata (projeto → mídias, miniaturas, exportações, arquivos
  no OPFS) acontecem numa função, dentro de uma transação Dexie. Os arquivos
  do OPFS são apagados depois que a transação confirma.
- Os campos de status são uniões de strings no TypeScript, validados com Zod
  ao ler.
- Toda consulta usa um índice (`[projectId+…]`).

O esquema completo, com os tipos do documento, está em `replica/schema.ts`.

```
projects      id, name, createdAt, updatedAt, aspectRatio, fps, durationUs, thumbAssetKey, docVersion
              índices: updatedAt (lista de rascunhos, mais recente primeiro)
projectDocs   projectId (chave), doc (JSON da linha do tempo), savedAt
assets        id, projectId, kind, opfsPath, name, mime, sizeBytes, durationUs, width, height,
              fps, rotation, hasAudio, codec, status ('importing'|'ready'|'missing'|'error'), createdAt, updatedAt
              índices: projectId, [projectId+kind]
derivatives   id, assetId, kind ('thumbs'|'waveform'|'proxy'), opfsPath | data, createdAt
              índices: assetId, [assetId+kind]
exports       id, projectId, settings, status ('queued'|'running'|'done'|'error'|'cancelled'),
              progress, outputPath, sizeBytes, error, createdAt, updatedAt
              índices: projectId, status
history       id, projectId, seq, patches, inversePatches, label, createdAt
              índices: [projectId+seq]   (limitado aos últimos 200 passos por projeto)
```

As regras "duras" do recon viram invariantes do documento, checadas por uma
função `validateDoc()` em todo commit e nos testes:

- Na faixa principal, os clipes não se sobrepõem e não deixam buraco. Ela é
  "magnética", como no original.
- `0 ≤ inUs < outUs ≤ asset.durationUs` em todo clipe com mídia.
- Uma transição nunca é mais longa que a metade do menor clipe vizinho.
- Os keyframes de uma propriedade ficam em ordem e sem tempo repetido.
- A velocidade fica entre 0,1 e 100.

## API

Não há rotas HTTP. A "API" são os comandos do editor (tudo que muda o
documento passa por eles e entra no desfazer) e as mensagens trocadas com os
workers.

### Comandos do editor (store)

| comando | faz | input | output | fluxo |
| --- | --- | --- | --- | --- |
| `project.create` | cria projeto + doc vazio | nome?, aspectRatio | projectId | F01 |
| `project.open` | carrega doc, checa mídias ausentes | projectId | doc, assetsMissing[] | F02 |
| `project.rename / duplicate / delete` | gestão de rascunhos | projectId | — | F02 |
| `media.import` | copia arquivos para o OPFS, lê metadados, gera miniaturas e forma de onda | File[] | assetIds | F01, F08 |
| `media.replace` | troca a mídia de um clipe mantendo as edições | clipId, File | — | F02 |
| `timeline.insertClips` | põe mídias na faixa principal ou de sobreposição | assetIds, trackId, atUs | clipIds | F01, F08 |
| `clip.split` | divide no cursor | clipId, atUs | [leftId, rightId] | F03 |
| `clip.trim` | apara início ou fim | clipId, edge, deltaUs | — | F03 |
| `clip.move` | reordena ou muda de faixa | clipId, trackId, atUs | — | F01 |
| `clip.delete / duplicate` | | clipId | — | F03 |
| `clip.set` | muda qualquer propriedade (velocidade, volume, fade, filtro, ajuste, transformação, recorte, máscara, chroma, opacidade, mistura, animação) | clipId, patch | — | F04, F09 |
| `keyframe.toggle` | cria ou remove keyframe no cursor | clipId, property | — | S16 |
| `transition.set` | põe ou tira transição | fromClipId, type?, durationUs | — | F07 |
| `text.add / set` | texto na faixa de texto | style, atUs | clipId | F06 |
| `audio.add / record / extract` | música do Arquivos, narração, áudio de um vídeo | File \| Blob \| clipId | clipId | F04 |
| `captions.generate` | transcreve e cria a faixa de legendas | language, source | trackId | F05 |
| `captions.setStyle` | estilo em lote | trackId, style | — | F05 |
| `canvas.set` | proporção e fundo | aspectRatio, bg | — | F10 |
| `history.undo / redo` | | — | — | todos |
| `export.start / cancel` | gera o MP4 | settings | exportId | F11 |
| `export.share` | abre a folha de compartilhamento do iOS (salvar vídeo, AirDrop, apps) | exportId | — | F11 |

### Mensagens com os workers

| worker | entrada | saída |
| --- | --- | --- |
| media | `import(file)`, `thumbs(assetId)`, `waveform(assetId)`, `decodeAt(assetId, us)` | metadados, quadros (`VideoFrame`, transferidos), progresso |
| export | `run(doc, settings)`, `cancel()` | progresso, `done(outputPath)`, `error` |
| captions | `transcribe(audioPcm, lang)` | segmentos com palavras e tempos |

Chamadas externas: só uma, e opcional. É a transcrição por API (por exemplo,
a da OpenAI) com a **sua** chave, guardada no aparelho. Nenhuma API da CapCut,
nem mesmo as que aparecem no navegador.

Jobs: nenhum agendado. Ao abrir o app, uma limpeza apaga arquivos órfãos do
OPFS e exportações com mais de 7 dias.

## The parts that bite

- **Memória do Safari:** o iOS fecha a aba sem aviso se ela passar do limite.
  Nunca carregar um vídeo inteiro na memória. Ler por partes do OPFS, fechar
  cada `VideoFrame` assim que usar (`frame.close()`) e limitar a fila do
  decodificador a poucos quadros. Testar com um clipe de 10 min em 4K 60 fps.
- **Segundo plano:** quando o app sai da tela, o Safari congela a página e a
  exportação para. Mostrar "mantenha o app aberto", usar a Screen Wake Lock
  API para a tela não apagar e retomar ou reiniciar a exportação ao voltar.
- **O Safari pode apagar os dados:** pedir `navigator.storage.persist()` na
  primeira abertura (PWA instalado costuma receber) e mostrar o espaço usado
  com `navigator.storage.estimate()`. O backup do projeto em arquivo (`could`)
  é a rede de segurança.
- **Importar do Rolo da Câmera:** um PWA não acessa a fototeca. Só o
  `<input type="file" accept="video/*,image/*" multiple>`, e o iOS pode
  converter HEVC para H.264 se não for configurado para manter o original.
  Copiar para o OPFS na hora, porque o `File` deixa de valer depois.
- **Rotação, HDR e taxa variável:** vídeos do iPhone vêm com matriz de
  rotação, muitas vezes em HDR (Dolby Vision/HLG) e às vezes com taxa de
  quadros variável. Ler a rotação do container, converter HDR para SDR na
  composição (a primeira versão exporta SDR) e trabalhar com timestamps reais,
  não com "quadro n".
- **Codecs:** perguntar ao aparelho (`VideoEncoder.isConfigSupported`) antes
  de oferecer H.264/HEVC, 4K ou 60 fps. Só mostrar o que passar no teste.
- **Sincronia de áudio e vídeo:** a prévia usa o relógio do `AudioContext`
  como mestre e o vídeo segue. A exportação usa a mesma linha do tempo em
  microssegundos dos dois lados.
- **Desfazer:** um passo por gesto, não um por quadro de arraste. Os patches
  são agrupados até o dedo soltar.
- **Salvar sem travar:** salvar o documento com debounce de 500 ms, numa
  transação. Ao abrir, se o doc não passar no `validateDoc()`, cair para a
  última versão boa do histórico.
- **Fuso horário:** não se aplica além das datas da lista de rascunhos
  (formatadas no fuso do aparelho).
- **Concorrência e idempotência:** não há servidor nem webhooks. O único risco
  é o mesmo projeto aberto em duas janelas. Usar `navigator.locks` por projeto.
- **LGPD:** os vídeos nunca saem do aparelho, a não ser que você ative a
  transcrição por API.

## Build order

1. **Fatia vertical (provar que o iPhone aguenta):** importar um vídeo, ver
   na prévia, dividir, apagar um pedaço, exportar MP4 e salvar no Rolo da
   Câmera. Tudo feio, sem estilo.
   Telas S01 (simples), S02, S03 (prévia + 1 faixa), S04 (Dividir, Excluir),
   S17 (só 1080p 30). Stores: projects, projectDocs, assets. Comandos:
   `project.create`, `media.import`, `timeline.insertClips`, `clip.split`,
   `clip.trim`, `clip.delete`, `export.start`, `export.share`. Critério de
   pronto: um vídeo de 3 min em 4K do seu iPhone exporta sem fechar a aba.
2. **Essenciais, por área:**
   - Projeto e rascunhos: S01 completa, salvamento automático, renomear,
     duplicar, excluir, mídia ausente, PWA instalável e offline.
   - Linha do tempo: miniaturas, forma de onda, zoom com pinça, arrastar para
     reordenar, desfazer e refazer (store `history`).
   - Clipe: velocidade constante, volume (S05, S04).
   - Áudio: música do Arquivos, fade (S07, S08).
   - Texto: S09 com estilo e transformação na prévia.
   - Formato e fundo: S15.
   - Transições: S06 (fade, dissolver, deslizar, zoom, desfoque).
   - Exportação completa: S17 com resolução, fps e taxa de bits.
3. **Importantes:** legendas automáticas (S10, worker de legendas), sobreposição
   e mistura (S12), filtros e ajustes (S14), keyframes (S16), recortar, girar,
   inverter, congelar, substituir, animações, narração, extrair áudio. Depois
   os opcionais: curvas de velocidade, máscaras, chroma key, remover fundo,
   estabilizar, efeitos, stickers e backup do projeto.
4. **Melhorias do `/replica-entrepreneur`:** entram aqui quando ele rodar.
   Sinais que já aparecem no recon: o original esconde 4K, recursos de IA e
   "sem marca d'água" atrás do Pro. No seu clone tudo isso é seu desde o
   primeiro dia.
