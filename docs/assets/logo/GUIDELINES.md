# PP Agent logo guidelines

## 1. The logo

- **Idea:** two layers of leaves grow around one core, larger toward the end of the turn: many inputs, one agent. The layers echo the product's panels, and the sky blue carries over from the earlier mark.
- **Primary mark:** the app-icon tile (`svg/pp-agent-icon.svg`). Use it wherever a blue square fits: app icons, avatars, the logo in the product and on the website.
- **Versions:** horizontal lockup, stacked lockup, tile-less symbol, wordmark only.
- **Every version comes in:** full colour, on dark, and one colour (blue, black, white).
- **Small-size cut:** a bolder drawing with 10 solid leaves for 16 to 47 px. The fine veins and translucent layers vanish at that size, so never shrink the full icon below 48 px.

## 2. Files

| Folder                                            | What is in it                                                                                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg/`                                            | Masters. `pp-agent-icon`, `-icon-small`, `-symbol-{blue,black,white,reversed}`, `-symbol-small-{blue,black,white}`, `-horizontal[-on-dark,-blue,-black,-white]`, `-stacked[...]`, `-wordmark-{ink,blue,black,white}`, `favicon.svg` |
| `png/`                                            | Transparent PNG exports of the masters at set sizes (icon 1024/512/256/128, lockups 2400 and 1600 wide)                                                                                                                             |
| `web/`                                            | `favicon.ico` (16/32/48), `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html`                                                            |
| `board/`                                          | `presentation.html` and its slides, with mockups for a desktop app                                                                                                                                                                  |
| `app-icon.png`, `mark-blue.png`, `mark-white.png` | Same file names as before, now holding the new icon and the flat blue and white symbols                                                                                                                                             |

Rules for choosing a file:

- **Full colour** (gradient, translucent layers) only on a screen, on white, light backgrounds, or the dark lockup on near-black.
- **Tile-less reversed symbol** (`pp-agent-symbol-reversed.svg`): only on a flat brand-blue or dark background. It is translucent and disappears on white.
- **One-colour** (`-blue`, `-black`, `-white`): print, embroidery, engraving, stamps, anything without gradients. These are flat, with real gaps between the leaves.

## 3. Clear space

Keep a clear zone of **1 × U** around the logo on all sides, where **U = one quarter of the icon tile's height** (a tile 256 high gives U = 64). For the tile-less symbol, U is a quarter of the symbol's height. The zone scales with the logo.

## 4. Minimum size

| Version                     | Screen      | Print      |
| --------------------------- | ----------- | ---------- |
| Icon, full detail           | 48 px       | 12 mm      |
| Icon, small-size cut        | 16 px       | 5 mm       |
| Flat symbol                 | 32 px       | 8 mm       |
| Flat symbol, small-size cut | 16 px       | 5 mm       |
| Horizontal lockup           | 160 px wide | 40 mm wide |
| Stacked lockup              | 96 px wide  | 25 mm wide |

[INFERENCE] These sizes come from tests at 16, 32 and 48 px on screen. The print values have not been proofed.

## 5. Colour

| Name      | HEX       | RGB           | CMYK (approx.)   | Use                                       |
| --------- | --------- | ------------- | ---------------- | ----------------------------------------- |
| Sky Blue  | `#2E86BE` | 46, 134, 190  | 76 / 29 / 0 / 25 | Primary brand colour, flat marks, accents |
| Sky Light | `#43A0DC` | 67, 160, 220  | 70 / 27 / 0 / 14 | Top of the icon gradient                  |
| Sky Deep  | `#2579B3` | 37, 121, 179  | 79 / 32 / 0 / 30 | Bottom of the icon gradient               |
| Deep Blue | `#1F5F8F` | 31, 95, 143   | 78 / 34 / 0 / 44 | Text and links on light backgrounds       |
| Ink       | `#0F1B26` | 15, 27, 38    | 61 / 29 / 0 / 85 | Wordmark, text, dark backgrounds          |
| Mist      | `#EAF4FB` | 234, 244, 251 | 7 / 3 / 0 / 2    | Light panels                              |

CMYK values are converted from RGB. Match print colours to a printed proof. No Pantone value has been assigned or checked.

Contrast ratios: white on Sky Blue is 3.99:1, so use it for the logo, large text and icons only. For body text on blue, use Deep Blue (white on Deep Blue is 6.79:1). Ink on white is 17.4:1.

**Approved pairs:**

- Full-colour icon on white, Mist, light grey, or Ink.
- Dark lockup (white wordmark) on Ink or near-black.
- Reversed symbol on Sky Blue or Ink.
- Blue, black or white one-colour versions on any flat background with enough contrast.
- Sky Blue symbol on near-black or Ink (about 5:1 and 4.4:1), as in the dark theme of the app.

## 6. Typography

- **Wordmark:** Geist SemiBold, converted to outlines, tracking -1.2 %, tightened space around the word gap. Do not retype it.
- **Product and documents:** Geist (the font the desktop and web apps already use). Geist is released under the SIL Open Font License 1.1, which allows use in logos. Web fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.

## 7. Don'ts

- Don't recolour outside the palette, rotate, stretch or squash the logo.
- Don't add shadows, outlines or extra gradients.
- Don't put the full-colour icon below 48 px. Use the small-size cut.
- Don't place the reversed symbol on white or on a busy photo without a tile behind it.
- Don't rearrange or resize the parts of a lockup.
- Don't recreate the wordmark by typing it.
- Don't mirror the symbol. The direction of growth is part of the mark.

## 8. Handover notes

**Tests run:** the icon and flat symbols were checked at 16, 32 and 48 px with pixel tests, in greyscale, in blur (squint), mirrored and rotated 180° (no unintended readings), on light, dark, brand-colour, photo-like and pattern backgrounds, and in favicon, app-icon and header contexts. The SVG audit flags only the intended gradients, opacity and the high point count of the flat versions.

**Known limits:**

- The full-colour icon uses gradients, translucent overlays and stroked veins and edges. It is the screen master only. For print, embroidery and one-colour use, take the flat versions.
- The flat versions are outlined shapes made by boolean cuts, so they have a high point count (about 590 points for the full symbol). They are clean in vector editors, but a designer may want to simplify them by hand.
- The wordmark is stock Geist SemiBold in outlines. The symbol carries the identity. Custom letterforms would be a later step.
- The mockups on the board use the full icon even at small sizes. Production uses the small-size cut there.

**Open items:**

1. Run a trademark and reverse-image search before the mark is public. A leaf mark in a blue tile is a crowded area, so this matters.
2. Confirm print colours with a printer.
3. The apps still ship the previous mark: `apps/web/src/assets/logo-mark-*.png`, `apps/desktop/build/icon.*` and `apps/desktop/resources/icons`. Replace them from `png/` and `web/` when the identity goes live.
