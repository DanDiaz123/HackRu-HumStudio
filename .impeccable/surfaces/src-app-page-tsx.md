---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components"]
---

# Studio editor (main UI)

Scope: the single-route studio at `/`: arrangement view, zoomed track, record, generate, reveal. Mode: Operate. Backend generation is mocked behind `src/lib/generate.ts`.

Audience/job: HackRU judges watching a 90-second demo; a user picks an instrument track, hums, and sees the track filled with generated music.

Constraints: desktop Chrome/Edge first; mic may be denied (fall back to a clearly labeled demo hum); reduced motion skips the reveal choreography.

Memorable moment: the hum prints onto the flooded lane as a live halftone spectrogram, then the generated notes set in over it like type on a sleeve.

## Direction contract

THESIS: Each track is a Reid Miles Blue Note sleeve: one flood color, heavy condensed type, and the hum as its photograph. Refuses the gray DAW with candy-colored clip blocks.

OWN-WORLD: Near-black ground (#0d0d0d), off-white type, one flood color per instrument (orange, blue, yellow, red, teal). Archivo across the board: condensed 62-wdth black caps for names and display, normal width for controls, tabular numerals. Square corners, no shadows except the zoom lift; black note bars on flood fields; halftone dots for audio.

STORY: The judge sees five instrument lanes, clicks one, watches their voice print as halftone across the flooded lane, waits through a short "setting the session" stage, and sees notes set in left to right, then plays it back.

FIRST VIEWPORT: Top transport strip (wordmark, play/stop/rewind, BPM, position, quantize, export). Left 232px track headers: flood-colored sleeve-spine header with the ink name, M/S marks. Right: bar ruler plus five lanes sharing the viewport height (min 56px, so the arrangement fills a projector) over 8 bars with clips as flood blocks holding black note bars; empty lanes read "Click to hum". Primary action: clicking a lane.

FORM: Blue Note Sleeve (impeccable's pick over the assigned rank-4 riso direction); seed 3cd8369c. Signature move: the flood (zoomed lane fills with its sleeve color; spectrogram as duotone halftone; notes set like type).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
