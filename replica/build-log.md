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

| ID | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- |
| shell | 2026-10-17 | done | — | — |
| S01 Início | 2026-10-17 | done | — | — |
| S02 Seletor de mídia | 2026-10-17 | partial | no grid of the camera roll: a PWA can't read the photo library, so "Novo projeto" opens the iOS photo picker and S02 becomes the import progress | the whole screen is replaced by an iOS limit |
| S03 Editor | 2026-10-17 | partial | only the main track (no overlay, audio, text tracks); drag to reorder; transitions | the preview needs a single `<video>` element so iOS keeps allowing play() |
| S04 Ferramentas do clipe | 2026-10-17 | partial | Dividir, Velocidade, Volume, Duplicar, Excluir and Substituir work; Recortar, Inverter, Congelar and Mistura are stubs | — |
| S05 Velocidade | 2026-10-17 | partial | constant speed only, 0.1x–10x; no curves, no keep-pitch | — |
| S06 Transição | — | stub | everything | — |
| S07 Áudio | — | stub | everything | — |
| S08 Ferramentas de áudio | — | not started | needs audio tracks | — |
| S09 Texto | — | stub | everything | — |
| S10 Legendas automáticas | — | not started | — | — |
| S11 Texto para fala | — | not started | — | — |
| S12 Sobrepor | — | stub | everything | — |
| S13 Efeitos / Stickers | — | stub | everything | — |
| S14 Filtros e Ajustar | — | stub | everything | — |
| S15 Formato | 2026-10-17 | partial | blurred and image backgrounds | — |
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
