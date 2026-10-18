# Build log

App: `app/` (Vite + React + TypeScript). Run `npm install`, then `npm run dev`;
the design system is at `#/design`. Unit tests: `npx vitest run`.

Everything below was checked in Chromium at 440×956 (iPhone Pro Max size) and
1440×900 with an end-to-end script: import, split, delete, undo/redo, speed,
format, playback, export, rename, duplicate, delete project, reopen. No console
errors.

**First iPhone test (2026-10-17, Safari, https://garagem-edits.pages.dev):**
import of a 3 s video from the camera roll, preview with sound, split,
delete, export at 1080p (2 MB) and save to the camera roll all worked. Still
untested on the device: running as an installed home-screen app, offline,
pinch zoom, and a long (2–3 min) or 4K export.

**Second iPhone test (2026-10-17, home-screen app, a ~1:38 4K video from
the camera):** import took about a minute, the preview stayed black, and the
4K export was very slow and then failed with "Decoder failure". Likely cause:
the iPhone records 4K HDR (Dolby Vision, 10-bit) by default. Fixes in the
next commit: the `<video>` element is now the preview (Safari shows HDR
there; painting HDR onto a canvas can come out black), thumbnails decode key
frames only, copying and reading the file run in parallel, the preview
releases its hardware decoder during export, export decodes frames in order
and draws them straight to the output (no intermediate canvas), decoder
errors name the file and suggest 1080p, and the export shows time left. In
Chromium a 15 s 4K60 clip now imports in 1.7 s and exports in 29 s (1080p)
and 37 s (4K); the iPhone HEVC/HDR case still needs a retest.

**Instant editing (2026-10-17):** after the iOS picker hands over the
files, the app now reads only their metadata and opens the editor (0.38 s in
Chromium for a 15 s 4K60 clip plus a short one). Thumbnails and the copy into
OPFS run in the background, one file at a time; the preview and the export
use the picked file from memory until the copy is done. A pill on the preview
shows "Guardando vídeo no app… n%". If the app is closed mid-copy, that clip
shows as missing next time and can be replaced. The wait inside the iOS
picker (it converts HDR/HEVC to a compatible format before handing the file
over) is outside the app: choosing "Atual" in the picker's options, if
present, or picking from the Files app avoids it.

**Import test on the iPhone (2026-10-18, screen recording):** three
file-input variants (`video/*`, exact `.mov/.mp4` types, no `accept`, then
"Fototeca" from the menu) all got the same result: the iOS photo picker
converted the HEVC recording to H.264 (171 MB for 1:38 4K) in about 70 s
before handing it over. A fast first run (6 s, 167 MB) was iOS reusing the
conversion from the day before. The app's own part took 0.0–0.3 s every time.
Conclusion: a web app cannot skip this conversion from the photo library; the
Files app ("Escolher Arquivos") is the remaining route, and a native wrapper
is the only full fix. The test buttons were removed.

**Bug from the iPhone (2026-10-18): a reopened project showed a black preview
and felt stuck.** Every earlier iPhone test edited a freshly picked file, kept
in memory. A reopened project reads the copy saved in OPFS, and that File has
no type (the stored path has no extension), so the blob URL had an empty
content type; Safari will not play that, Chromium sniffs it (which is why the
browser checks missed it). Fix: files read back from OPFS get their original
type again (a typed slice, no copy), and a video that fails to load now shows
a message on the preview instead of staying black.

**Confirmed on the iPhone (2026-10-18):** a reopened project shows its
video again (typed OPFS files), and voice-over recording works after switching
the iOS audio session to play-and-record while recording.

**Captions crashed the app on the iPhone (2026-10-18):** Safari showed "Um
problema ocorreu repetidamente" (iOS killed the page, almost always memory).
The GPU path loaded the base model's encoder in fp32 (~80 MB, several copies
while the session is built). Changes: captions now run on the CPU with 8-bit
models (~75 MB base, ~40 MB tiny), WebGPU is opt-in; a previously loaded model
is disposed before another loads; the preview's video is released during the
run; and a run that never finished is reported on the next open, switching
the quality to "Mais rápida".

**Caption templates (2026-10-18):** the iPhone run worked but the captions
looked odd next to the reference video the user sent (one UPPERCASE word at a
time in the middle of the frame, bold white with a dark offset shadow, a quick
pop, plus a glowing orange phone number). Whisper's ONNX models give sentence
timestamps only, so each word's time is now estimated from the loudness of
the voice inside its sentence (`captions/align.ts`). Captions are built from
those words by a template: "Palavra por palavra" (the default, matching the
reference), "Destaque amarelo" (3 words, the spoken one in yellow),
"Clássica", "Caixa", "Neon" and "Impacto". Switching the template regroups
the same words without transcribing again. Text items got 8 style presets,
"Neon" matching the phone number in the reference. Side by side with a frame
of the reference, the exported word is the same size and position.

**Captions like CapCut (2026-10-18):** from the user's CapCut screenshots,
"Legendas" now opens "Gere legendas automáticas": rows for "Gerar a partir
de" and "Idioma de origem" (each opens its own list), a "Modelos" card with
a strip of templates and a chevron to the full two-column grid, "Opções
avançadas" (quality) folded away, and one "Gerar" button; the sheet closes
when the captions are ready. 27 templates, each tile playing a sample
caption with the same drawing code as the video. New highlight kinds: a
box behind the spoken word (optionally with a border), a bigger spoken word,
and words revealed as they are spoken. Four more open fonts (Poppins, Lilita
One, Luckiest Guy, DM Serif Display). Touching the timeline while it plays
now pauses, as in CapCut.

**All of CapCut's caption templates (2026-10-18):** from 13 screenshots of
CapCut's grid, 87 templates now, in CapCut's order (ours after). New in the
caption drawing: words re-flowed into lines of N (stacked when 1) with a
sideways stagger, colour and size per word position, a colour for words not
spoken yet, each word popping in as spoken, a gradient fill (metal, blue), a
background with rotation (badge), an emoji above the caption (one matching a
word, Portuguese and English list, else the template's), a typing cursor, and
a blur-in entrance done with a moved shadow since canvas filters are missing
in some Safari versions. Fonts added: Bangers, Chewy, Playfair Display,
Montserrat 900. CapCut's own fonts and textures can't be copied; the looks
are rebuilt with open fonts.

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| shell | 2026-10-17 | done | — | — |
| S01 Início | 2026-10-17 | done | — | — |
| S02 Seletor de mídia | 2026-10-17 | partial | no grid of the camera roll: a PWA can't read the photo library, so "Novo projeto" opens the iOS photo picker and S02 becomes the import progress | the whole screen is replaced by an iOS limit |
| S03 Editor | 2026-10-18 | partial | overlay (picture-in-picture) track | the preview needs a single `<video>` element so iOS keeps allowing play() |
| S04 Ferramentas do clipe | 2026-10-17 | partial | Dividir, Velocidade, Volume, Duplicar, Excluir and Substituir work; Recortar, Inverter, Congelar and Mistura are stubs | — |
| S05 Velocidade | 2026-10-17 | partial | constant speed only, 0.1x–10x; no curves, no keep-pitch | — |
| S06 Transição | 2026-10-18 | done | — | our model keeps the total length (A holds its last frame, B waits on its first) instead of overlapping clips; the preview animates the <video> and a still with CSS so HDR video never has to be drawn on a canvas; the export prepares stills before each clip so two decoders never run at once |
| S07 Áudio | 2026-10-18 | done | the original's music library (licensed, out of scope) | preview sound now goes through Web Audio (GainNode on the video element) so volume works on iOS; music lanes are decoded once and re-synced if they drift > 120 ms from the video |
| S08 Ferramentas de áudio | 2026-10-18 | partial | beat marking, noise reduction, speed for audio | — |
| S09 Texto | 2026-10-18 | done | loop animations | drawing the same text in the preview and in export (one drawText for both); a paused preview shows the text without its entrance animation, or it would be invisible at its first frame |
| S10 Legendas automáticas | 2026-10-18 | done | word timing is estimated, not measured | Whisper on the device: transformers.js in a worker, WebGPU when the device has it, else WASM; the 27 MB ONNX runtime comes from the jsDelivr CDN (over Pages' 25 MB file limit) and the model from Hugging Face, both cached after the first run. Tested here with whisper-tiny on CPU (no Hugging Face access in this environment): 9.5 s of speech in 11.6 s. Portuguese accuracy and the GPU path need the iPhone |
| S11 Texto para fala | — | not started | — | — |
| S12 Sobrepor | — | stub | everything | — |
| S13 Efeitos / Stickers | — | stub | everything | — |
| S14 Filtros e Ajustar | — | stub | everything | — |
| S15 Formato | 2026-10-18 | done | image background | blur without canvas `filter` (not in every Safari): shrink twice and stretch back; the preview blurs a still with CSS so HDR video is never drawn on a canvas |
| S16 Keyframes | — | not started | — | — |
| S17 Exportar | 2026-10-17 | done | the file is kept in memory, not in OPFS (fine up to a few minutes of 1080p; long 4K needs a streaming target) | choosing the codec at runtime: this test browser had no H.264, so it exported VP9/Opus in MP4; the iPhone should pick H.264 |

## Notes

- **Volume in the preview:** iOS ignores `video.volume`, so the preview only
  honours mute (0%). Export applies the real volume. Moving preview audio to
  Web Audio fixes it; it comes with the audio tracks (S07).
- **Undo history** lives in memory. Closing the app keeps the edits (autosave)
  but not the undo steps. The `history` store in the database is there for
  when this matters.
- **Export memory:** audio is mixed in one `OfflineAudioContext` and the MP4
  is built in memory. A 3-minute 1080p export is about 200 MB of RAM at peak
  by estimate. Over that, it needs the streaming version (OPFS target, audio
  in chunks). Measure on the iPhone first.
- **H.264 in tests:** the Chromium used for testing can't decode or encode
  H.264, so the H.264 test clip was rejected with the right message and the
  other clips were VP9. On the iPhone, H.264 and HEVC are the normal case.
- **Icons** are placeholders until `/replica-brand`.
