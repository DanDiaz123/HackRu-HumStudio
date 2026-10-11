---
name: HumStudio
description: Hum into a track and hear it come back as music.
colors:
  ground: "#0d0d0d"
  panel: "#161616"
  line: "#262626"
  line-strong: "#3a3a3a"
  text: "#f2f1ec"
  muted: "#9a9a94"
  ink: "#0d0d0d"
  rec: "#ff4a3d"
  flood-melody: "#f26b1d"
  flood-bass: "#3d7ee6"
  flood-keys: "#e8c41c"
  flood-drums: "#e0412f"
  flood-strings: "#23a39b"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "min(84px, 20cqw)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(40px, 6vw, 96px)"
    fontWeight: 900
    lineHeight: 0.85
    fontVariation: "'wdth' 62"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 62"
  title-label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 62"
  control:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    fontFeature: "'tnum'"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  none: "0px"
spacing:
  hairline: "1px"
  clip-inset: "6px"
  control-gap: "6px"
  gutter: "16px"
  group-gap: "20px"
  transport: "56px"
  ruler: "28px"
  row-collapsed: "36px"
  row-min: "56px"
  head: "232px"
  head-compact: "104px"
components:
  button-transport:
    backgroundColor: "#222222"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    size: "36px"
  button-transport-play:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    size: "36px"
  button-record:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    height: "46px"
    padding: "0 16px"
  button-record-on:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "46px"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "34px"
    padding: "0 14px"
  button-export:
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "36px"
    padding: "0 14px"
  input-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "34px"
    padding: "0 8px"
  track-head:
    backgroundColor: "{colors.flood-melody}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    width: "{spacing.head}"
    padding: "0 12px 0 16px"
  clip-generated:
    backgroundColor: "{colors.flood-melody}"
    textColor: "{colors.ink}"
    typography: "{typography.title-label}"
    rounded: "{rounded.none}"
  clip-sample:
    textColor: "{colors.flood-keys}"
    typography: "{typography.title-label}"
    rounded: "{rounded.none}"
---

# Design System: HumStudio

## Overview

**Creative North Star: "The Blue Note Sleeve"**

Every track is a Reid Miles record sleeve: one flat flood color, heavy condensed caps set tight, and the hum as the sleeve's photograph, printed as a 45° black halftone. The arrangement is a near-black studio surface where five flood-colored spines stack down the left like records on a shelf; opening one floods the whole lane with its color and turns the timeline into the sleeve itself.

The system is dense and operational (a DAW people can read at projector distance), but its voice comes from print, not from software chrome. Color is spent only on instrument identity; everything else is near-black ground, off-white type, and hairline rules. Depth is almost absent: the one lift in the system is the zoomed sleeve rising over the shelf. The world refuses the gray DAW with candy-colored rounded clip blocks.

**Key Characteristics:**
- One flood color per instrument, carried by the spine header, its clips, its empty-lane prompt, and the zoomed lane.
- Archivo throughout: 62% width black caps for names and display, normal width for controls, tabular numerals everywhere.
- Square corners, hairline rules, flat fields.
- Black ink on flood fields: note bars, halftone dots, labels and controls all invert to ink inside a flood.
- Motion is a set-in, not a bounce: the flood zoom and the left-to-right note reveal share one long ease-out.

## Colors

A near-black studio ground with five saturated print floods; the floods are identity, never decoration.

### Primary
- **Melody Orange** (flood-melody): Melody's spine, clips, prompt and zoomed flood. Also the text caret and selection fill, the one place a flood leaves its track.
- **Pressing Blue** (flood-bass): the Bass sleeve.
- **Sleeve Yellow** (flood-keys): the Keys sleeve.
- **Label Red** (flood-drums): the Drums sleeve.
- **Session Teal** (flood-strings): the Strings sleeve.

Floods are applied through a per-row `--flood` custom property set from the instrument definition in `src/lib/tracks.ts`; components never hard-code a specific flood.

### Secondary
- **Tally Red** (rec): the record dot inside the Record button only. It is a signal light, not a surface.

### Neutral
- **Studio Black** (ground): page ground, empty lanes, input wells.
- **Console Black** (panel): transport strip and bar ruler.
- **Hairline** (line): row dividers, ruler and transport rules, field borders.
- **Strong Hairline** (line-strong): bar ticks in the ruler and the Export button stroke.
- **Sleeve Ink** (ink): type, note bars, halftone dots, controls and focus rings on any flood. Same value as ground, named separately because its job is print ink.
- **Off-White** (text): primary type on dark, play button fill, playhead, active Record (Stop) fill.
- **Liner Gray** (muted): field labels, ruler numbers, ruler corner.

Lane grids are drawn with two repeating gradients: bar lines at #2a2a2a and beat lines at #1a1a1a on ground; inside a flood they become black at 30% and 10%. Note bars carry stretch handles on both ends (up to 10px, at most a quarter of the note) that tint with the flood on hover. A zoomed lane adds a black-8% rule under every pitch (or drum) row so each note sits on a visible row; note bars keep a 1px flood gap on their right edge only.

### Named Rules
**The One Flood Rule.** A row carries exactly one flood. Every colored mark in that row (spine, clip, outline, label, empty prompt, zoomed lane) is that flood or ink on it. Floods never mix within a track and never appear as gradients.

**The Ink On Flood Rule.** Anything set on a flood field is Sleeve Ink: type, note bars, halftone, M/S marks, focus outlines. Off-white never sits on a flood.

## Typography

**Display Font:** Archivo (variable, wdth axis, loaded via next/font as `--font-archivo`), with system-ui fallback
**Body Font:** Archivo at normal width
**Label/Mono Font:** none distinct; numerals use `font-variant-numeric: tabular-nums` globally

**Character:** One family in two widths. Condensed 62% black caps are the sleeve lettering (names, the wordmark, prompts, the Record button); normal-width semibold is the console (transport, fields, hints).

### Hierarchy
- **Display** (900, min(84px, 20cqw), 1, 62% width, caps): the zoomed track's name in its spine; sized against the head container so the longest name also fits with the fallback font.
- **Headline** (900, clamp(40px, 6vw, 96px), 0.85, 62% width, caps): in-lane prompts ("Hum the melody", "Allow the microphone") and the generating title (clamp(48px, 7vw, 6rem), 0.82).
- **Title** (900, 24px, 1, 0.01em, 62% width, caps): spine names in the arrangement; the wordmark (26px) and empty-lane "Click to hum" (26px) share it. Collapsed rows drop to 16px; compact layout to 18px.
- **Title-label** (800, 14px, 0.02em, 62% width, caps): clip labels and the ruler corner. The Record button uses the same voice at 20px with 0.03em.
- **Control** (600, 15px, tabular): position readout, BPM and snap fields, Export (14px).
- **Body** (500, 14px, 1.35, max 22ch): the instrument hint in the zoomed spine; generating stage line at 17px/600.
- **Label** (600, 11px, 0.08em, caps, muted): transport field labels (BPM, Snap). The ghost button uses 12px/700/0.06em caps.

### Named Rules
**The Two Widths Rule.** Condensed width is for names and things you read from across a room; normal width is for anything you operate or read as a sentence. Never set a sentence or a numeric control in the condensed cut.

**The Tabular Rule.** All numerals are tabular, set once on the body, so position, BPM and bar numbers never jitter during playback.

## Layout

A fixed full-viewport studio (100dvh, no page scroll) in three bands: the transport strip (56px minimum), the 28px bar ruler, and the rows region that fills the rest. The transport stays one row and squeezes in steps rather than wrapping freely: below 1680px the chords readout hides (chords stay in the Key tooltip and the Learn lane strip); below 1540px field labels stack above their controls; below 1280px Export is icon-only; below 1180px the wordmark loses its spine width and the position readout hides. The project actions (Undo, Redo, Open, Save, ?, Export) sit together at the right. Below 1060px the header wraps by group, never mid-group: brand and transport first, then settings and actions, sharing a row when they fit; below 480px brand and actions / transport / settings, with the ? button hidden (no keyboard). Selects ellipsize as a last resort; no text clips at the edge or spills outside its box. Ruler and every row share one two-column grid: a fixed spine column (232px) and a fluid lane spanning 8 bars of 4/4. All lane geometry is derived in percent from beats and pitch; nothing is positioned in stored pixels.

In the arrangement, the five rows divide the available height equally with a 56px floor, so the shelf fills a projector. Zooming a row is a grid-template-rows change: the opened row takes all remaining height (240px floor) while the others collapse to 36px slivers, with their labels and empty prompts removed. Collapsed spines keep their full flood so the ink names stay readable; only their lanes dim to 45% (80% on hover).

Spacing rhythm is small and functional: 16px left gutter for spine text, the wordmark and the ruler corner; 6px insets for clips and between transport controls; 20px between transport groups. The playhead track overlays the lane column only, offset by the spine width.

**Compact (max-width 720px):** the spine column narrows to 104px; M/S marks and the instrument hint are hidden, and Learn's Key/Role stack label-over-value. Field labels stay visible (stacked). Spine names drop to 18px; the wordmark is 18px with intrinsic width; Record is 40px/13px with a 12px icon so its contents fit the narrow spine.

Check layout at 320, 390, 720, 800, 1024, and 1280px widths: zoom each of the five tracks and confirm its full name fits, the Key value remains readable, and all toolbar controls stay on screen. Repeat with the fallback font and a longer key/chord label; wrapping must preserve the text.

## Elevation & Depth

Flat by construction. Depth comes from color fields and hairlines, not shadows. There is exactly one elevation: the zoomed row lifts above the collapsed shelf (`0 18px 40px rgb(0 0 0 / 0.45)`, z-index 1). The playhead carries a 1px dark halo (`0 0 0 1px rgb(0 0 0 / 0.4)`) purely so the off-white line stays visible over light floods. Inset box-shadows elsewhere are strokes, not depth: the sample-clip outline, the lane hover outline and the 1-2px ink seam at the end of each note bar.

### Shadow Vocabulary
- **Sleeve lift** (`box-shadow: 0 18px 40px rgb(0 0 0 / 0.45)`): the zoomed row only.
- **Playhead halo** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4)`): legibility of the playhead over floods.

### Named Rules
**The Single Lift Rule.** Only the opened sleeve rises. No card, button, clip or menu casts a shadow.

## Shapes

Square everywhere (0px radius): buttons, fields, clips, note bars, M/S marks, the status mark, the wordmark's inverted "HUM" block. Borders are 1px hairlines on dark and 1.5px ink strokes on floods. Note bars are plain rectangles with a 1px (2px when flooded) seam on their trailing edge so adjacent notes read as separate pieces of type. The only round forms are the record dot and the halftone dots, both literal.

## Components

### Buttons
Blunt, printed blocks; state is shown by inverting fill and ink, not by glow.
- **Shape:** square (0px).
- **Transport:** 36px squares, dark fill (#222, #2e2e2e on hover) with off-white icons; Play is inverted (off-white fill, ink icon).
- **Mute/Solo:** keep compact M/S marks with named accessible labels and native titles. A small ink tooltip appears beside the button on hover or keyboard focus without taking layout space.
- **Record:** the primary action inside a flooded spine. Ink block, off-white condensed caps (20px/800), Tally Red dot; 46px tall. While recording it inverts to off-white with an ink stop square and reads "Stop".
- **Ghost (Demo hum):** 1.5px ink outline, ink 12px tracked caps; hover fills ink and the text takes the flood color.
- **Export:** 1px Strong Hairline outline, 14px semibold, download icon; hover brightens the stroke to off-white.
- **Text links on floods (spine name, "All tracks"):** no chrome; hover underlines in ink (3px thick, 4px offset on names).
- **Disabled:** 40% opacity, not-allowed cursor; spine names and lanes disabled during work keep full opacity.
- **Focus:** 2px off-white outline at 2px offset; inside any flood the outline becomes ink. Lanes use a -2px inset offset.

### Inputs / Fields
- **Style:** 34px wells on Studio Black, 1px Hairline border, square, 15px/600 tabular values; label to the left in 11px tracked muted caps.
- **Focus:** global 2px off-white outline.
- **Track sound:** native select immediately beneath the expanded track title and above its hint, with a visible Sound label. Use flood fill, ink text/border/focus, square corners, and normal-width controls. Loading/error text and Retry sound sit beneath it. Keep the control within the spine at compact widths; its accessible name and title retain the full sound name.
- **Track note settings:** Sensitivity and Snap sit under Sound in the expanded spine, using the same native selects and ink/flood colors. Two compact columns become one on a narrow spine. Reserve feedback space so changing source availability does not shift the controls. BPM and Key stay in the transport.
- **Copy Region:** a 2px ink outline with transparent off-white fill overlays the piano roll. Selected notes get an inset off-white outline, and destination ghosts are translucent with a dashed ink outline. Status text is positioned inside the lane without moving the grid. No new animation.
- **Sound status:** loading/failure feedback stays in that track's Sound section; no temporary sample notices above the ruler. Sound switching must preserve transport, ruler, and row-region positions.
- **Drum lanes:** all five rows and their notes remain visible. Underline and lightly shade the selected row label; unselected notes retain 65% ink opacity. Only the selected lane has drag/resize handles, while any visible note can be deleted by right-click.
- **Note sensitivity:** labeled native Low/Medium/High select beside Snap in the top transport menu. Selection swaps cached profiles immediately; Snap updates existing notes immediately. Hand-edited parts keep their edits when sensitivity changes. Use the existing square field styling; keep its label visible at compact widths, let the header squeeze as above, and disable changes while recording/generating.

### Navigation
The transport strip is the only navigation: wordmark in the spine column (off-white "HUM" block with ink letters, then "STUDIO"), then rewind/play, position, BPM, Snap, and Export pushed right. Zoomed rows return via the "All tracks" back link at the top of the spine.

### Track Spine (signature)
The sleeve spine: a full-height flood block in the spine column holding the instrument name in ink condensed caps and 24px M/S toggles (1.5px ink stroke; pressed state fills ink with flood-colored letters). A 1px black-30% rule separates spine from lane. When zoomed, the spine becomes the sleeve's front: back link, Display name, hint, and the Record controls pinned to the bottom with a status line led by a 10px square mark (filled and blinking in two hard steps while live).

### Clips
- **Generated clip:** solid flood block inset 6px top and bottom, condensed caps label in ink, black note bars inside, scaled to the take's bar range.
- **Sample clip:** transparent with a 1.5px inset flood outline; label and note bars in the flood color; the label always reads "<Instrument> · Sample". Outline vs solid is the honesty signal: presets never look like output.
- **Empty lane:** "Click to hum" in Title type, flood-colored, at the lane's left; hovering the lane draws a 1px flood inset outline and underlines the prompt.

### The Flood (signature)
Opening a track floods its lane with the instrument color over the 520ms grid-row transition (`cubic-bezier(0.16, 1, 0.3, 1)`). Inside the flood: octave pitch labels in ink at the left with black-16% row rules (on a flood chip that sits above the notes when Learn is off or in Drums, and under them when Learn labels each note), black note bars on the pitch axis, and the hum.
- **Halftone spectrogram:** a canvas, not a raster: Sleeve Ink dots on a 7px screen rotated 45°, sized by magnitude and mapped onto the lane's own pitch axis so generated notes land on their dots. Melodic lanes weight the print around the detected fundamental, so harmonics don't print an octave above where no note will land; Drums print the full band.Live while recording with a 2px ink cursor; dims to 35% while generating and ghosts to 16% after.
- **Generating:** a Headline and stage line set low-left in the lane, one per real pipeline step (notes found, snapped and fitted, key and chords), each stamped in. Raw hummed notes print in at 60% ink behind the 2px sweep, then transition (700ms, same ease) to their fitted, snapped places; chord labels stamp onto the bar grid.
- **Reveal:** a 2px ink sweep travels to the take's last beat over 1.6s while each note sets in with a left-to-right clip-path wipe (380ms, same ease), delayed in proportion to its start beat across the take's extent, like type being set.
- **Reduced motion:** all animations and transitions are removed, and the scan and sweep bars are hidden; notes appear in place.

## Do's and Don'ts

### Do:
- **Do** give each instrument exactly one flood and route it through `--flood`; every mark in that row derives from it.
- **Do** set everything on a flood in Sleeve Ink, including focus outlines.
- **Do** use Archivo condensed 62% black caps for names, prompts and the Record button, and normal-width semibold for controls and sentences.
- **Do** keep every corner square and every rule a hairline (1px on dark, 1.5px ink on floods).
- **Do** distinguish sample clips (flood outline, "· Sample" label) from generated clips (solid flood).
- **Do** draw audio as ink halftone on the 45° screen, on the same pitch axis as the notes.
- **Do** use the single ease `cubic-bezier(0.16, 1, 0.3, 1)` for the flood zoom and note set-in, and drop all motion under reduced motion.

### Don't:
- **Don't** round corners or add drop shadows; the zoom lift is the only elevation.
- **Don't** place off-white type or controls on a flood field.
- **Don't** introduce a sixth accent, gradients between floods, or a gray DAW chrome with candy-colored rounded clips.
- **Don't** use Tally Red for anything but the record dot.
- **Don't** set sentences, hints or numeric controls in the condensed cut.
- **Don't** render the hum as a waveform line or a blurred heatmap; it is printed halftone.
