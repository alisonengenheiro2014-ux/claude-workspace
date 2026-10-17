# Recon map: CapCut (app iOS, refeito como PWA)

Escopo: o editor de vídeo do app CapCut para celular. Criar projeto, importar
mídia do iPhone, editar na linha do tempo (cortar, dividir, velocidade, texto,
áudio, sobreposição, filtros, ajustes, transições), legendas automáticas e
exportar para o Rolo da Câmera. Roda como PWA no Safari de um iPhone 18 Pro Max.
Para: uso pessoal do dono, no negócio de edição de vídeos. Um usuário só: sem
login, sem equipe, sem cobrança, sem nuvem.
Data: 2026-10-17

## Como este mapa foi feito (e o que falta)

- O ambiente bloqueou o acesso direto a capcut.com e apps.apple.com. Tudo aqui
  vem de resultados de busca pública (trechos da listagem da App Store, da
  central de ajuda e do blog da CapCut, e de tutoriais de terceiros) e do
  conhecimento geral de como o app funciona.
- **Os nomes de menu e a ordem dos botões têm confiança média.** Eles mudam
  entre versões e regiões. Antes do `/replica-design`, faça capturas de tela
  da sua própria conta (tela inicial, editor, cada menu de baixo, exportação)
  e salve em `replica/screens/` com o ID da tela no nome (`S04-editor.png`).
  Isso é referência e nunca entra no clone.
- **Termos de uso:** não consegui ler os termos da CapCut daqui. Antes de usar
  sua conta como referência, confira se eles proíbem usar o app para construir
  um produto concorrente. Como o clone é só para você e não vai ser vendido, o
  risco é baixo. Mesmo assim, nada do que a CapCut possui (código, ícones,
  efeitos, músicas, templates, marca) entra no clone.

## Sources

| # | fonte | URL | notas |
| --- | --- | --- | --- |
| 1 | App Store (listagem iOS) | https://apps.apple.com/us/app/-/id1500855883 | linha do tempo multipista, velocidade 0,1x–100x com curvas, fluxo óptico, chroma key, estabilizar, keyframes, legendas automáticas, texto para fala, remover fundo. Lido via trechos de busca |
| 2 | Guia CapCut para iPhone | https://www.capcut.com/resource/capcut-for-iphone | visão geral do editor no iPhone |
| 3 | Ajuda: exportar 2K/4K | https://www.capcut.com/help/export-videos-in-capcut | rótulo da resolução ao lado de Exportar; 4K só se o aparelho e a mídia suportarem; frame rate afeta as opções |
| 4 | Ajuda: templates | https://www.capcut.com/help/templates-not-appearing | aba Templates na parte de baixo da tela inicial |
| 5 | Ajuda: usar template | https://www.capcut.com/vi-vn/help/use-template | "Usar template" e depois importar a mídia |
| 6 | Como usar o CapCut | https://capcut.com/resource/how-to-use-capcut | congelar, inverter, keyframes, máscaras, curvas de velocidade |
| 7 | Corte com IA | https://www.capcut.com/resource/ai-video-cut | legendas automáticas por reconhecimento de fala |
| 8 | Standard vs Pro | https://www.capcut.com/resource/capcut-standard-vs-pro | o que é pago: 4K, sem marca d'água, IA avançada, nuvem |
| 9 | Tutorial completo (PrimalVideo) | https://primalvideo.com/guides/capcut-video-editing-tutorial/ | layout: prévia no alto, linha do tempo embaixo, barra de ferramentas; pinça para zoom; transição no quadradinho entre clipes; Exportar no canto superior direito |
| 10 | Iniciantes (Skeepers) | https://community.skeepers.io/blog/capcut-for-beginners-everything-you-need-to-start-editing-your-content-today/ | dividir no cursor, arrastar bordas para aparar, filtro "Aplicar a todos" |
| 11 | Configurações de exportação (Miracamp) | https://www.miracamp.com/learn/capcut/how-to-export-high-quality-videos | resolução, 24/30/60 fps, H.264 ou HEVC, taxa de bits |
| 12 | Recursos de IA (FreeAcademy) | https://freeacademy.ai/es/lessons/capcut-ai-features | Texto → Texto para fala; Vídeo → Recorte → Recorte automático |
| 13 | Suporte a WebCodecs no Safari | https://www.testmu.ai/web-technologies/webcodecs-safari/ | WebCodecs completo a partir do Safari 26 (iOS 26) |
| 14 | Dados de codecs | https://webcodecsfundamentals.org/codecs/hevc.html | HEVC aceito na maioria das sessões iOS; testar com `isConfigSupported()` |
| 15 | sua própria conta | (o app no seu iPhone) | ainda não usado; capturas de tela pendentes |

## Core loop

Abrir um projeto, jogar os clipes do Rolo da Câmera na linha do tempo, cortar e
montar com texto, música e legendas, e exportar um vídeo pronto para postar.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Início | abrir o app | começar um projeto e retomar rascunhos | botão "Novo projeto", lista de rascunhos (miniatura, duração, data), menu "…" do rascunho (renomear, duplicar, excluir), barra de navegação inferior | vazio (sem rascunhos), preenchido, modo seleção |
| S02 | Seletor de mídia | S01 → Novo projeto; ou "+" no editor | escolher vídeos e fotos do aparelho | abas Vídeos / Fotos / Todos, grade com duração, seleção múltipla numerada, contador, botão "Adicionar" | vazio, carregando, permissão negada, seleção feita |
| S03 | Editor | depois de S02, ou tocar num rascunho | montar o vídeo | barra superior (fechar, rótulo de resolução, Exportar), prévia, controles (play, tempo atual/total, desfazer, refazer, tela cheia), linha do tempo multipista, cursor fixo no centro, "+" para adicionar clipe, faixa "Adicionar áudio", barra de ferramentas inferior (Editar, Áudio, Texto, Stickers, Sobrepor, Efeitos, Filtros, Ajustar, Formato, Fundo) | projeto vazio, reproduzindo, pausado, item selecionado, rolando a linha do tempo |
| S04 | Ferramentas do clipe | S03 → tocar num clipe ou em Editar | editar o clipe selecionado | barra rolável: Dividir, Velocidade, Animações, Volume, Excluir, Recortar, Máscara, Chroma key, Recorte (remover fundo), Inverter, Congelar, Estabilizar, Substituir, Duplicar, Opacidade, Extrair áudio, Redução de ruído; voltar | clipe de vídeo, clipe de foto, nada selecionado (ferramentas desativadas) |
| S05 | Velocidade | S04 → Velocidade | mudar a velocidade do clipe | abas Normal / Curva, régua 0,1x–100x, opção manter tom, curvas prontas e editor de pontos, fluxo óptico | normal, curva, aplicando |
| S06 | Transição | S03 → quadradinho entre dois clipes | transição entre clipes | grade por categoria, controle de duração, "Aplicar a todos" | nenhuma, escolhida, aplicada em todos |
| S07 | Áudio | S03 → Áudio, ou "Adicionar áudio" | trilha, efeitos sonoros, extrair áudio, narração | Sons (biblioteca), Efeitos sonoros, Extraído (de um vídeo), Gravar (narração com contagem regressiva) | vazio, gravando, faixa adicionada |
| S08 | Ferramentas de áudio | S03 → tocar numa faixa de áudio | editar a faixa | Volume, Aparecer/Sumir gradualmente (fade), Dividir, Velocidade, Batidas (marcar batidas), Excluir, Duplicar, Redução de ruído | selecionado |
| S09 | Texto | S03 → Texto → Adicionar texto, ou tocar num texto | criar e estilizar texto | campo de texto + teclado, abas Estilo (fonte, cor, contorno, sombra, fundo, alinhamento), Efeitos, Animação (entrada, saída, loop); arrastar, girar e escalar na prévia | editando, selecionado na linha do tempo |
| S10 | Legendas automáticas | S03 → Texto → Legendas automáticas | transcrever a fala em legendas | idioma, origem (áudio do vídeo, narração, todos), estilo, "Iniciar"; depois uma faixa de legendas editável em lote | antes, processando, pronto, erro (sem fala) |
| S11 | Texto para fala | S09 → Texto para fala | narração a partir do texto | lista de vozes por idioma, prévia | escolhendo, gerado |
| S12 | Sobrepor | S03 → Sobrepor → Adicionar sobreposição | vídeo ou foto por cima (picture-in-picture) | reabre S02; na prévia: mover, escalar, girar; Mistura (modo e opacidade); mesmas ferramentas de S04 | adicionado, selecionado |
| S13 | Efeitos / Stickers | S03 → Efeitos ou Stickers | efeitos visuais de vídeo e stickers | grade por categoria, duração na linha do tempo, ajustes por efeito | escolhido, na linha do tempo |
| S14 | Filtros e Ajustar | S03 → Filtros / Ajustar | cor | filtros com intensidade; Ajustar: brilho, contraste, saturação, exposição, temperatura, matiz, nitidez, vinheta, realces, sombras; "Aplicar a todos" | sem ajuste, ajustado |
| S15 | Formato e Fundo | S03 → Formato / Fundo | tamanho do quadro e fundo | proporções (9:16, 16:9, 1:1, 4:5, 4:3, original), fundo (cor, desfoque, imagem) | escolhido |
| S16 | Keyframes | S03 → botão de losango com um clipe selecionado | animar posição, escala, rotação, opacidade e cor ao longo do tempo | botão adicionar/remover keyframe, losangos marcados no clipe | sem keyframes, keyframe no cursor, entre keyframes |
| S17 | Exportar | S03 → rótulo de resolução / Exportar | configurar e gerar o vídeo | resolução (480p–4K), frame rate (24/25/30/50/60), taxa de bits, tamanho estimado, botão Exportar; progresso em %; ao terminar, compartilhar e salvar | configurando, exportando, concluído, erro, cancelado |
| S18 | Templates | S01 → aba Templates | montar um vídeo a partir de um modelo | feed por categoria, prévia, "Usar template" → S02 → preenche os espaços | (ver "Out of scope") |

## Flows

```
F01 Editar um vídeo do zero e exportar
    S01 -> S02 -> S03 -> S04 (dividir/aparar/excluir) -> S03 -> S17
    happy path clicks: 6 (Novo projeto, escolher clipe(s), Adicionar, Dividir, Exportar, Exportar)
    edge: clipe com fuso/rotação HEVC do iPhone, vídeo vertical num quadro 16:9,
          clipe de 4K 60 fps longo (memória), app vai para segundo plano no meio da exportação,
          sem espaço no aparelho, permissão de fotos negada

F02 Retomar um rascunho
    S01 -> S03
    happy path clicks: 1
    edge: mídia original apagada do Rolo da Câmera (mostrar "mídia ausente" e oferecer substituir),
          Safari apagou o armazenamento do site

F03 Cortar o "miolo" de um clipe
    S03 -> mover o cursor -> S04 Dividir -> mover o cursor -> Dividir -> tocar no pedaço -> Excluir
    happy path clicks: 4
    edge: dividir no primeiro ou último quadro, desfazer/refazer

F04 Colocar música e equilibrar com a voz
    S03 -> S07 -> escolher uma faixa (do Arquivos do iPhone) -> S08 Volume e Sumir gradualmente
    happy path clicks: 5
    edge: música mais longa que o vídeo (cortar no fim), formatos que o Safari não decodifica

F05 Legendas automáticas
    S03 -> S09/S10 -> Iniciar -> corrigir palavras -> estilo em lote
    happy path clicks: 3 até gerar
    edge: sem fala, duas pessoas falando, palavras erradas, legenda passando da borda segura

F06 Texto com animação
    S03 -> S09 -> digitar -> Estilo -> Animação -> arrastar a duração na linha do tempo
    happy path clicks: 4
    edge: texto longo quebrando linha, emoji, texto fora da área segura do Reels/TikTok

F07 Transição entre clipes
    S03 -> quadradinho entre clipes -> S06 -> escolher -> (Aplicar a todos)
    happy path clicks: 3
    edge: transição mais longa que o clipe menor

F08 Sobreposição / picture-in-picture
    S03 -> S12 -> S02 -> Adicionar -> ajustar na prévia
    happy path clicks: 4
    edge: várias sobreposições empilhadas, ordem das camadas

F09 Câmera lenta / acelerado
    S03 -> clipe -> S05 -> Normal ou Curva
    happy path clicks: 3
    edge: 0,1x num clipe de 30 fps (sem fluxo óptico fica travado), áudio com tom alterado

F10 Mudar proporção para outra rede
    S03 -> S15 -> 9:16 -> fundo desfocado
    happy path clicks: 3
    edge: elementos fora do quadro novo

F11 Exportar com configurações
    S03 -> S17 -> resolução, fps -> Exportar -> salvar no Rolo da Câmera / compartilhar
    happy path clicks: 3
    edge: 4K com mídia em 1080p (não oferecer 4K), exportação interrompida, arquivo grande demais para a memória
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Barra superior do editor | — | normal, exportando | S03 |
| Botão | primário (Exportar), secundário, ícone, ícone com rótulo (barra de ferramentas) | normal, pressionado, desativado, carregando | todas |
| Barra de ferramentas inferior | principal, de clipe, de áudio, de texto | rolando, item ativo, desativado | S03, S04, S08, S09 |
| Prévia (canvas) | com alças de seleção, tela cheia | reproduzindo, pausado, item selecionado | S03, S09, S12, S15 |
| Linha do tempo | faixa principal, sobreposição, áudio, texto, efeito, legenda | rolando, zoom (pinça), item selecionado, arrastando, aparando | S03 |
| Clipe na linha do tempo | vídeo, foto, áudio (forma de onda), texto, efeito | normal, selecionado (bordas de aparar), keyframes marcados, mídia ausente | S03 |
| Cursor (playhead) | — | fixo no centro, encaixe magnético | S03 |
| Marcador de transição | vazio, com transição | normal, selecionado | S03 |
| Folha inferior (bottom sheet) | grade, abas, controles | aberta, recolhida | S05–S16 |
| Régua deslizante | 0–100, -50..+50, velocidade logarítmica | arrastando, valor padrão | S05, S08, S14 |
| Grade de opções | filtros, transições, efeitos, fontes | carregando, selecionado | S06, S09, S13, S14 |
| Seletor de mídia | grade, abas | vazio, carregando, selecionado com número | S02 |
| Cartão de rascunho | — | normal, modo seleção | S01 |
| Barra de progresso | linear, circular com % | em andamento, concluído, erro | S10, S17 |
| Toast | info, erro | aparecendo, sumindo | todas |
| Diálogo de confirmação | excluir, sair sem exportar | aberto | S01, S03 |
| Botão de keyframe | adicionar, remover | inativo, ativo | S03, S16 |

## Inferred data model

O clone guarda tudo no próprio iPhone (IndexedDB para o projeto, OPFS para os
arquivos de mídia). Não há conta nem servidor.

```
Project   id, name, created_at, updated_at, aspect_ratio, canvas_bg (color|blur|image),
          fps, duration_ms (derivado), thumbnail_blob
          evidence: S01 cartão de rascunho, S15, S17
          confidence: high

MediaAsset  id, project_id, kind (video|image|audio), file_ref (OPFS), name, mime,
            duration_ms, width, height, fps, rotation, has_audio, waveform (json), thumbs
            evidence: S02, F02 "mídia ausente"
            confidence: high

Track     id, project_id, kind (main|overlay|audio|text|effect|caption), order, muted, hidden
          evidence: S03 linha do tempo multipista (fonte 1)
          confidence: high

Clip      id, track_id, asset_id (null para texto/efeito), start_ms (na linha do tempo),
          in_ms, out_ms (dentro da mídia), speed (number) | speed_curve (pontos),
          reverse, volume, fade_in_ms, fade_out_ms, opacity, blend_mode,
          transform {x, y, scale, rotation}, crop, mask {shape, params, invert, feather},
          chroma {color, intensity, shadow}, filter {id, intensity}, adjust {brightness,...},
          animation {in, out, loop}, stabilize, denoise
          evidence: S04, S05, S08, S12, S14, fontes 1, 6
          confidence: high (campos), medium (nomes exatos)

Keyframe  id, clip_id, t_ms (relativo ao clipe), property, value, easing
          evidence: S16, fonte 1 "keyframes em todas as configurações"
          confidence: high

Transition  id, project_id, from_clip_id, to_clip_id, type, duration_ms
            evidence: S06, fonte 9
            confidence: high

TextItem  (Clip com kind text) text, font, size, color, stroke, shadow, bg, align, preset_style
          evidence: S09
          confidence: high

Caption   id, track_id, start_ms, end_ms, text, words [{t, w}], style_ref
          evidence: S10, fonte 7
          confidence: medium (palavras com tempo é palpite, mas é o que permite edição em lote e animação por palavra)

ExportJob  id, project_id, resolution, fps, bitrate, codec (h264|hevc), status, progress, output_ref
           evidence: S17, fontes 3, 11
           confidence: high

History   pilha de comandos do projeto para desfazer/refazer
          evidence: botões desfazer/refazer em S03
          confidence: high
```

Relationships: Project 1-n MediaAsset, Project 1-n Track, Track 1-n Clip,
Clip 1-n Keyframe, Project 1-n Transition (entre Clips vizinhos da faixa
principal), Track(caption) 1-n Caption, Project 1-n ExportJob.

## Feature matrix

See `features.csv`. Must: 27, should: 20, could: 13, skip: 9.

## Out of scope (cannot or should not be cloned)

- **Biblioteca de músicas e efeitos sonoros da CapCut.** É licenciada. No
  clone, use músicas suas, do app Arquivos, ou de bibliotecas livres.
- **Templates da comunidade.** São criados pela rede de usuários da CapCut. Dá
  para ter templates próprios no futuro, mas não os deles.
- **Os efeitos, stickers, filtros, fontes e animações prontos deles.** Os
  arquivos são da CapCut. O clone recria os tipos (desfoque, brilho, tremor,
  fade, zoom...) com código próprio e fontes abertas.
- **Nuvem, espaço de equipe e colaboração.** Você usa sozinho. O armazenamento
  é local.
- **Publicar direto no TikTok.** Isso depende de parceria e de API de outra
  empresa. A folha de compartilhamento do iOS resolve.
- **Os modelos de IA da CapCut.** Legendas automáticas, remover fundo e texto
  para fala podem ser refeitos com modelos abertos ou APIs suas, nunca os
  deles.
- **Marca, nome, ícone e textos da CapCut.** O `/replica-brand` dá nome e cara
  próprios ao clone.

## Size

Telas: 18 (17 no escopo). Fluxos: 11. Entidades: 10.

O que é difícil, em ordem:

1. **Prévia em tempo real com várias faixas no Safari.** É preciso juntar
   vídeo, sobreposição, texto, filtros, máscara e chroma key a 30–60 fps num
   canvas WebGL/WebGPU. Tem que rolar a linha do tempo e trocar de quadro sem
   travar.
2. **Exportar dentro do navegador.** O plano é decodificar e codificar com
   WebCodecs (completo a partir do iOS 26) e mixar o áudio com
   `OfflineAudioContext`. O resultado vira MP4 (H.264/HEVC) e vai para o Rolo
   da Câmera pela folha de compartilhamento. Tudo isso precisa caber na memória
   que o iOS dá a uma aba.
3. **Limites de um PWA no iOS.** O Safari pode apagar o armazenamento do site,
   pausa a página em segundo plano (a exportação para) e não deixa ler o Rolo
   da Câmera direto, só pelo seletor de arquivos. Os arquivos importados vão
   para o OPFS, e o app precisa avisar quando faltar espaço.
4. **Legendas automáticas.** Whisper rodando no aparelho (WebGPU) ou uma API de
   transcrição com sua chave.
5. **Remover fundo e estabilizar.** São a parte cara em processamento. Ficam
   para depois do essencial.

Tamanho: o app inteiro é **XL** e precisa ser recortado. O recorte deste mapa
(as linhas `must`) é **L**, um trimestre de trabalho a sério. Vale construir
primeiro só o F01 de ponta a ponta (importar, cortar, exportar) e confirmar no
seu iPhone que a exportação funciona. Esse é o maior risco técnico, e todo o
resto depende dele.
