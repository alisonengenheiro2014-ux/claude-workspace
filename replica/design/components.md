# Components

Specs for every component in the recon list (`replica/recon.md`, section
Components). Code lives in `app/src/ui/`. All of them can be seen in every
state on the design page (`app/src/design/DesignPage.tsx`; screenshots in
this folder: `design-full.png`, `design-sheet.png`, `design-dialog.png`).

Status: **not measured against the original.** There were no screenshots in
`replica/screens/`, so sizes and colours follow the common patterns of a dark
mobile video editor. Re-check against your own screenshots and adjust the
tokens, not the components.

General rules:

- Dark theme only. The preview has to be the brightest thing on screen.
- Touch targets are at least 44×44 pt (`--layout-touch-min`), even when the
  icon is smaller.
- Colours come only from tokens (`bg-surface`, `text-text-muted`...). The
  Tailwind default palette is switched off in `theme.css`.
- Icons: Lucide (ISC licence). Font: the system font (San Francisco on the
  iPhone), not shipped with the app. Nothing from the original: no icons,
  effects, sounds or copy.
- Every label in Portuguese, written fresh.
- `prefers-reduced-motion` turns off the transitions.

```
Button
  variants  primary (Exportar, Adicionar, Novo projeto), secondary, ghost, danger
  sizes     sm 32px (top bar), md 40px, lg 48px (Novo projeto)
  states    default, pressed (active: brightness/surface-3), focus-visible (2px ring, accent),
            disabled (40% opacity), loading (spinner + label kept, aria-busy)
  tokens    primary: bg accent, text on-accent; danger: bg danger, text on-danger;
            radius sm (sm) / md; font xs, sm/600, base/600
  a11y      real <button type=button>; loading disables it but keeps the label for screen readers
  used on   S01, S02, S03, S17, dialogs
```

```
IconButton
  variants  plain, pressed (toggle, accent)
  sizes     44×44 hit area, icon 20–24px
  states    default, pressed (active bg surface-2), toggled (aria-pressed, accent), focus-visible, disabled
  tokens    text text / accent / text-subtle when disabled
  a11y      `label` is required and becomes aria-label and title
  used on   S03 (fechar, desfazer, refazer, tela cheia), S04 (voltar), S01 (menu do rascunho)
```

```
TopBar (editor)
  layout    48px; left: fechar; right: resolution chip ("1080p ▾") + Exportar (primary sm)
  states    normal, exporting (Exportar loading)
  tokens    bg bg, chip text xs
  a11y      the chip's name includes the value: "Configurações de exportação, 1080p"
  used on   S03
```

```
Transport
  layout    40px; current/total time (mono, tabular), play/pause centred, undo/redo/fullscreen
  states    playing, paused, undo/redo disabled when the history is empty
  tokens    current time text, total text-muted
  a11y      play button name switches between "Reproduzir" and "Pausar"
  used on   S03
```

```
Toolbar + ToolbarItem
  variants  main (Editar, Áudio, Texto, Stickers, Sobrepor, Efeitos, Filtros, Ajustar, Formato),
            clip (back button + Dividir, Velocidade, Volume, Recortar, Mistura, Inverter, Duplicar, Excluir),
            audio, text
  sizes     64px tall; item min 64px wide; icon 24px; label 2xs (10/12)
  states    default, pressed, active (accent, aria-pressed), disabled (35% opacity, when nothing is selected),
            scrolling (horizontal, no scrollbar)
  tokens    bg surface, border-top border
  a11y      role=toolbar with a label; ←/→ move between enabled items and scroll them into view
  used on   S03, S04, S08, S09
```

```
Preview (canvas)
  layout    fills the space between top bar and transport; black canvas (canvas token) with the
            project frame centred at its aspect ratio
  states    playing, paused, item selected (white handles to move/scale/rotate), fullscreen
  a11y      the canvas is aria-hidden; every action it allows has a toolbar equivalent
  used on   S03, S09, S12, S15
  note      built in /replica-build (WebGL); the design page shows a placeholder
```

```
Timeline
  layout    220px; fixed white playhead in the centre (Playhead); tracks scroll under it;
            main track 52px with frame thumbnails, sub-tracks 32px
  track colours  track-video, track-overlay, track-audio (with waveform), track-text,
                 track-effect, track-caption; labels on-track 2xs
  states    scrolling, zoom (pinch), item selected, dragging, trimming
  a11y      each item is a button (aria-pressed when selected); a list view of the timeline
            for keyboard and VoiceOver comes with /replica-build
  used on   S03
```

```
TimelineClip
  variants  main (thumbs), overlay, audio (waveform), text, effect, caption
  states    default, selected (2px selection outline + white trim handles 12px each side),
            keyframes (white diamonds at their positions), missing media (scrim + warning
            "Mídia ausente")
  tokens    radius xs; selection; warning
  a11y      name = label + ", mídia ausente" when missing
  used on   S03
```

```
TransitionMarker
  variants  empty (white square), set (accent square)
  sizes     20px square inside a 44px hit area, overlapping the joint between clips
  a11y      "Adicionar transição" / "Editar transição"
  used on   S03 → S06
```

```
AddClipButton
  52px white square with "+", after the last clip on the main track
  a11y      "Adicionar mídia"
  used on   S03 → S02
```

```
Sheet (bottom sheet)
  layout    max 55vh so the preview stays visible; header 48px with title and ✓ (Concluir);
            radius lg on the top corners; respects the home-bar safe area
  states    open, closed; scrim at 30% so the preview can be judged while editing
  tokens    bg surface, shadow sheet, scrim
  a11y      Radix Dialog: focus trapped inside, Escape closes, focus returns to the opener
  used on   S05–S16
```

```
Slider
  variants  0..100, bipolar -50..+50 (default mark in the middle), speed 0.1x..10x/100x
  sizes     44px hit area, 4px track, 24px thumb
  states    default, dragging, at default (tick shows where the default is), disabled
  tokens    track surface-3, range accent, thumb text
  a11y      Radix Slider: label + aria-valuetext with the formatted value ("1.0x", "100%");
            arrow keys step; double-tap the thumb resets to the default
  used on   S05, S08, S12, S14
```

```
Tabs
  states    active (accent underline, text), inactive (text-muted); scrolls when crowded
  a11y      Radix Tabs: roving focus with arrow keys
  used on   S07, S09, S13
```

```
OptionGrid
  layout    4 columns; square preview + 2xs label; first tile is always "Nenhum"
  states    loading (8 pulsing tiles, aria-busy), selected (2px accent ring + accent label), none selected
  a11y      role=radiogroup, each tile role=radio with aria-checked; arrows move and select
  used on   S06 (transições), S09 (fontes, estilos), S13 (efeitos, stickers), S14 (filtros)
```

```
MediaTile (media picker)
  layout    4-column square grid, 2px gaps, edge to edge
  states    default (empty white circle), selected (number in an accent circle + accent inner ring
            + scrim), loading (no thumb yet)
  a11y      role=checkbox; name includes the duration and the selection number
  used on   S02 (and S12, which reuses the picker)
```

```
DraftCard
  layout    64px thumbnail, name (sm/600, truncated), "duração · data" (xs, text-muted), "…" menu
  states    default, pressed; empty list has its own state (dashed box, icon, two lines)
  a11y      the card opens the project; the menu is a separate button named "Opções de <nome>"
  used on   S01
```

```
ProgressBar / ProgressRing
  variants  linear (captions, imports), ring with % (export)
  states    running, error (danger), done
  a11y      role=progressbar with aria-valuenow 0..100 and a label
  used on   S10, S17
```

```
Toast
  variants  info (surface-3), error (danger)
  states    showing (3 s info, 6 s error), leaving
  a11y      info in an aria-live=polite region (role=status), errors assertive (role=alert)
  used on   all screens
```

```
ConfirmDialog
  variants  neutral (primary action), destructive (danger action)
  states    open, closed
  a11y      Radix AlertDialog: focus starts on Cancelar, Escape cancels
  used on   S01 (excluir rascunho), S03 (sair sem exportar)
```

```
KeyframeButton
  states    no keyframe at the playhead (outline diamond), keyframe here (filled, accent), disabled
  a11y      "Adicionar keyframe" / "Remover keyframe", aria-pressed
  used on   S03, S16
```
