---
name: Inkroom
description: A quiet shared whiteboard and lesson calendar for one-to-one online tutoring, built for a PC and for tablets with a stylus.
colors:
  nib-indigo: "#5b5bf0"
  nib-indigo-soft: "#ececff"
  brand-ink: "#3b36e0"
  cool-paper: "#f7f7f9"
  sheet-white: "#ffffff"
  sheet-hover: "#f1f1f4"
  hairline: "#e4e4ea"
  ink-text: "#0f1117"
  pencil-grey: "#6c7080"
  icon-graphite: "#3d4150"
  grid-dot: "#dcdee8"
  grid-dot-strong: "#b9bdd0"
  signal-red: "#e5484d"
  night-desk: "#0e0f13"
  night-sheet: "#17181d"
  night-board: "#131418"
  night-hover: "#23252d"
  night-hairline: "#2b2d37"
  night-text: "#ececf1"
  night-pencil: "#9093a3"
  night-icon: "#c3c5d1"
  nib-indigo-night: "#8f8fff"
  nib-indigo-night-soft: "#272850"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  control:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  small:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "tnum"
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  formula:
    fontFamily: "ui-monospace, JetBrains Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 600
rounded:
  md: "12px"
  lg: "18px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "36px"
components:
  button-primary:
    backgroundColor: "{colors.ink-text}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 14px"
  button-secondary-hover:
    backgroundColor: "{colors.sheet-hover}"
  button-tool:
    backgroundColor: "transparent"
    textColor: "{colors.icon-graphite}"
    rounded: "{rounded.md}"
    size: "40px"
  button-tool-active:
    backgroundColor: "{colors.nib-indigo-soft}"
    textColor: "{colors.nib-indigo}"
  button-danger-outline:
    backgroundColor: "transparent"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.md}"
    height: "44px"
  input:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 14px"
  chip-account:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.full}"
    height: "40px"
    padding: "0 14px 0 4px"
  pill-filter-selected:
    backgroundColor: "{colors.nib-indigo-soft}"
    textColor: "{colors.nib-indigo}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 14px"
  card-board-tile:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.lg}"
    padding: "10px"
  card-auth:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.lg}"
    padding: "24px"
    width: "340px"
  floating-island:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.lg}"
    padding: "6px"
---

# Design System: Inkroom

## Overview

**Creative North Star: "The Quiet Desk"**

Inkroom is a desk with a sheet of paper and one pen of indigo ink. A tutor on a PC and a student on an iPad draw on the same sheet in real time, and everything around the sheet steps back so the drawing stays in front. The paper is cool, never cream. Instruments float above the sheet as small frosted islands. Colour is mostly absent: the one indigo of the brand's pen nib marks what is active, chosen or focused, and nothing else.

This is an Operate surface: people come to teach and learn, not to admire the interface. Ambition shows as precision and restraint. Controls are generous targets for a finger or a stylus (40px tools, 36px on a touch screen so the rail fits; 44px fields on touch), labels are short Polish words in sentence case, and the layout changes its shape to fit the device: a wide bar on a PC, a compact bar on a smaller window, a rail down the left edge on a tablet held upright.

Dark mode is a night desk, not an inverted page. The board turns a deep blue-black, default black ink is painted in the light violet of the logo, white ink is painted black, and the indigo lifts to a lighter tone so it still reads as the same pen.

**Key Characteristics:**
- One accent (nib indigo) on a cool grey-white paper; everything else is neutral.
- Floating, frosted islands over a full-bleed drawing canvas.
- Two radii only: 12px for controls, 18px for containers and islands.
- One typeface (Inter) in three working weights; monospace only for formulas.
- Sentence-case labels, never tracked uppercase.
- Touch-first sizing, since the main student device is a tablet with a stylus.

## Colors

A cool, nearly colourless palette in which a single indigo carries all meaning.

### Primary
- **Nib Indigo** (`nib-indigo`): the state colour. Active tool, selected view, pressed filter pill, focus ring, the frame on the minimap, links in notices. Never a large fill.
- **Nib Indigo Soft** (`nib-indigo-soft`): the tint behind an active tool or a selected pill, and the account avatar's disc. Always paired with Nib Indigo text or icon.
- **Brand Ink** (`brand-ink`): the colour of the logo's nib only. Interface elements use Nib Indigo, never Brand Ink.

### Neutral
- **Cool Paper** (`cool-paper`): the page behind the panel and the login card, and the dotted backdrop of standalone pages.
- **Sheet White** (`sheet-white`): cards, fields, buttons, islands and the drawing board itself in light mode.
- **Sheet Hover** (`sheet-hover`): hover fill of quiet buttons and the minimap's canvas.
- **Hairline** (`hairline`): 1px borders of every card, field, island and button, and the dividers inside a toolbar.
- **Ink Text** (`ink-text`): body text and the primary button's fill (the primary action is "ink", not indigo).
- **Pencil Grey** (`pencil-grey`): secondary text, dates, sizes, small labels, placeholders at 70% opacity.
- **Icon Graphite** (`icon-graphite`): line icons in tools and buttons.
- **Grid Dot / Grid Dot Strong** (`grid-dot`, `grid-dot-strong`): the board's dot and square grids, and the scrollbar thumb.
- **Signal Red** (`signal-red`): errors and the destructive action. Outlined at rest, filled only for the final confirm.

The `night-*` keys are the same roles for dark mode: Night Desk is the page, Night Sheet the cards and islands, Night Board the drawing surface, and Nib Indigo Night with its soft tint replaces the indigo pair.

### Named Rules
**The One Ink Rule.** Indigo means "this is on, chosen, or focused". If an element is not in one of those states, it is not indigo. Primary actions are filled with Ink Text, not with indigo.

**The Cool Paper Rule.** Backgrounds stay cool and nearly white (or blue-black at night). No cream, beige or warm tints anywhere.

**The Swap, Don't Invert Rule.** In dark mode stored black ink is painted light violet (`nib-indigo-night`) and stored white is painted black. Every other ink colour stays as drawn. Board previews are shown as a dark sheet with light ink, never as a white rectangle.

## Typography

**Body Font:** Inter (self-hosted 400 and 600, latin and latin-ext for Polish), falling back to system-ui
**Formula Font:** the platform monospace (ui-monospace, JetBrains Mono, SF Mono, Menlo)

**Character:** one neutral, highly legible humanist grotesque doing every job, so that the drawings and handwriting on the board carry the personality. Hierarchy comes from size and weight steps, not from colour or case.

### Hierarchy
- **Headline** (650, 24px, -0.02em): the title of a standalone page ("Nie ma takiej tablicy", "Jak masz na imię?").
- **Title** (650, 17px, -0.01em): section headings in the panel ("Nowa tablica", "Moje tablice") and dialog titles.
- **Body** (400, 16px): fields and running text. 16px is the floor for inputs so iPad Safari does not zoom.
- **Control** (500, 15px): button labels.
- **Small** (400, 13px, tabular figures): dates, times, sizes, the zoom level, hints.
- **Label** (600, 12px, Pencil Grey): the small names above a group of controls ("Czyje", "Zmiana hasła", shape categories, menu sections).
- **Formula** (600, 14px, monospace): function formulas and coefficients of a coordinate plane only.

### Named Rules
**The Sentence Case Rule.** Labels and headings are written as sentences. No uppercase, no letter-spacing on small labels, no eyebrow above a heading.

**The Mono Means Maths Rule.** Monospace is for formulas and the digits of the maths tools. Dates, sizes and the zoom level use Inter with tabular figures.

## Layout

The board page is a full-bleed canvas with fixed islands at its edges: the brand mark top left, the board name, tool bar, people and share buttons in one centred top bar, background modes bottom left next to the feedback and theme corner, zoom and the minimap bottom right. Islands sit 12px from the edges and 8px from each other.

The tool bar has three layouts. **Full** (wider than 1500px): every tool, colour and width in one row. **Compact** (1500px and narrower): colour, width and style collapse into one settings button. **Rail** (a touch device in portrait): the tools stand in a column down the left edge, 68px from the top. Below 860px the top bar drops the tools to a second row; below 600px (a phone) the name shrinks to give way to the people and buttons, and the bottom islands stack instead of overlapping.

The panel (list of boards) is a single column up to 1200px wide, centred, with 16px minimum side gutters. The new-board form keeps a narrower 760px measure. Tiles are an auto-fill grid with a 220px minimum column and 12px gaps; each tile shows a 4:3 picture of the board, its name, date and size, and its actions.

Standalone pages (login, registration, guest name, missing board) centre one 340px card on Cool Paper with a 22px dot grid, the same dots as the board.

Spacing steps are 4, 8, 12, 16 and 24px, with 36px above a panel section heading and 12px below it.

## Elevation & Depth

Depth is one soft ambient shadow plus a frosted glass on everything that floats over the canvas. Cards in the panel are flat at rest and take the shadow on hover. Dialogs use the same shadow over a 40% black scrim. There is no second, stronger shadow.

### Shadow Vocabulary
- **Island** (`box-shadow: 0 1px 2px #10122008, 0 8px 24px #10122014`; at night `0 1px 2px #0006, 0 8px 24px #0009`): every floating island, popover, dialog, the auth card, and a board tile on hover.
- **Frost** (`background: color-mix(in srgb, var(--surface) 85%, transparent); backdrop-filter: blur(12px)`): islands over the canvas, so strokes stay faintly visible beneath the tools.

### Named Rules
**The Float Over Ink Rule.** Only things above the drawing float (islands, popovers, dialogs). Content on a page (tiles, forms) is flat and bordered, and lifts only in response to the pointer.

## Shapes

Two radii and a circle. Controls (buttons, fields, the preview frame, menu rows) use gently rounded 12px corners. Containers (tiles, islands, dialogs, popovers, the auth card) use 18px. Pills (account chip, filter choices, segmented controls) are fully round, and so are colour swatches and people's avatars. Every box has a 1px Hairline border; borders are never one-sided.

## Components

Spoken in one voice: calm, precise, and easy to hit with a stylus.

### Buttons
- **Shape:** gently rounded (12px), 40px tall (44px for full-width form actions).
- **Primary:** Ink Text fill, Sheet White label, 0 14px. One per view, for the main action ("Utwórz tablicę", "Zaloguj").
- **Secondary:** Sheet White with a Hairline border and Ink Text label; Sheet Hover on hover.
- **Tool:** a 40px square (36px with an 18px icon on a touch screen), transparent, Icon Graphite line icon; active is Nib Indigo Soft with a Nib Indigo icon. A small corner triangle marks a tool with a list behind it.
- **Danger:** outlined in Signal Red with a red label and a red 10% tint on hover; filled red only for "Usuń na zawsze".
- **Hover / Focus:** 120ms background change on hover; a 2px Nib Indigo outline with 2px offset on keyboard focus. Disabled is 45% opacity.

### Chips
- **Account chip:** a round pill with a 30px Nib Indigo Soft disc holding the account's picture or its initial, then the username in Ink Text.
- **Account pictures:** cheerful Fluent Emoji (Flat, MIT) animals and faces, bundled as SVG. On the board a person's chip is a disc of their cursor colour with the picture inside, so the colour reads as a ring; without a picture, the white initial on that disc.
- **Filter pills:** round, 36px (44px on touch), Icon Graphite text; selected is Nib Indigo Soft with Nib Indigo text and border.

### Cards / Containers
- **Board tile:** Sheet White, 18px corners, Hairline border, 10px padding, flat until hover. The 4:3 preview frame inside has 12px corners and shows the board as a light sheet (swapped to dark at night).
- **Auth card:** 340px wide, 24px padding, Island shadow, on the dotted Cool Paper page.
- **Dialog:** up to 420px wide, centred, a quiet title with a close cross, sections divided by Hairline rules with small labels.

### Inputs / Fields
- **Style:** Sheet White, Hairline border, 12px corners, 44px tall, 16px text, Pencil Grey placeholder.
- **Focus:** 2px Nib Indigo outline, 2px offset; the caret is indigo.
- **Error:** a Signal Red line of 14px text under the field, with the problem and the fix.

### Navigation
- **Panel header:** the logo on the left; on the right, secondary-style buttons for "Kalendarz", the account chip and "Wyloguj", all 40px tall. On a phone they wrap under the logo.
- **Board page:** the brand mark (40px tile) top left returns to the panel. On a phone the board's name folds into a 40px button with a document icon that opens the name in a small card.

### Floating Island (signature)
The heart of the board page: a frosted Sheet White pill-box with 18px corners, 6px padding, Hairline border and the Island shadow, holding 40px tool buttons separated into groups by 1px vertical Hairline dividers (horizontal ones in the rail).

### Motion
One quiet voice for everything that appears, never on the canvas and never in the way of a stroke:
- **Menus and popovers** open from where they hang: fade with a 0.96 to 1 scale, 150ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Dialogs and toasts** rise 6px while fading in, 180ms; the backdrop fades in 160ms.
- **The auth card** is the single page entrance: rise and fade, 220ms.
- **A pressed button** gives a little (scale 0.96, 80ms), so a tap with a finger or stylus feels answered.
- **A person joining** the board: their chip pops in once, 200ms, easing out without a bounce.
- **Theme switch:** a 220ms cross-fade of the whole page (View Transitions), after the canvas has repainted.
- Only opacity and scale move (the individual `scale` and `translate` properties), and everything is off under `prefers-reduced-motion: reduce`.

### Minimap
An island with a Sheet Hover canvas inside (14px corners) showing all strokes in miniature and the visible area as a Nib Indigo frame with a soft indigo fill.

## Do's and Don'ts

### Do:
- **Do** keep indigo for active, selected and focused states only (The One Ink Rule).
- **Do** use 12px corners for controls and 18px for containers, and nothing in between.
- **Do** make every tool and button 40px (36px on touch screens, never smaller), and fields and touch pills 44px.
- **Do** write labels in sentence-case Polish, as short as the action ("Utwórz tablicę", "Wyloguj", "Zmień hasło").
- **Do** float tools over the canvas as frosted islands with the single Island shadow.
- **Do** show dates, sizes and zoom in Inter with tabular figures.
- **Do** design both themes together: Night Desk, Night Sheet and the lighter indigo for dark mode.
- **Do** give a dead end a way out (the missing-board page links back home).
- **Do** keep motion under 220ms, opacity and scale only, with an exponential ease-out (never a bounce or overshoot), and switch it off for reduced motion.

### Don't:
- **Don't** use tracked uppercase labels or eyebrows above headings.
- **Don't** use monospace for anything except formulas and maths digits.
- **Don't** fill large areas or primary buttons with indigo.
- **Don't** add warm, cream or beige backgrounds, gradients, or gradient text.
- **Don't** put a coloured bar down one side of a card; use the full Hairline border or the indigo tint.
- **Don't** add a second, heavier shadow or hard offset shadows.
- **Don't** let islands overlap each other or the canvas tools on any screen from 375px up.
- **Don't** show a light, white board preview on the dark theme.
- **Don't** animate anything on the drawing canvas or anything that delays a stroke or a tool switch.
