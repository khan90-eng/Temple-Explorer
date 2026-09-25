# Scroll page toolkit

These build the six scroll pages that were not in Provat's original
animation (pylon, courtyard, hypostyle hall, inner court, chapels,
sanctuary). His own three — front wall, Horus, hieroglyphics — are used
unchanged and are not built from here.

- `plate.webp` — a blank sheet lifted out of his wall-comparison scroll. A
  clean, ink-free band was tiled through the middle, so the torn edges and
  the two side rolls are his, pixel for pixel.
- `frames/` — the illustrations, each a still from his own
  `Temple of Horus.mp4`. No outside imagery is used anywhere.
- `compose.py` — lays out title, lead line, illustration, caption and body
  on the plate using Poppins (closest free match to his Century Gothic).
  `**double asterisks**` mark bold, the way his pages bold key terms.

## To reword a page

Edit the `PAGES` list at the bottom of `compose.py`, then:

    python3 compose.py

It writes `page_*.png` next to itself. Those still need the white studio
background keyed out and converting to `.webp` before they go into
`assets/scrolls/` — ask Claude to redo that step, or see the build guide in
the Claude project for how it was done (flood-fill from the border on
bright, *neutral* pixels; his exports carry faint grey banding that a
brightness-only key leaves behind).

Requires: Pillow, numpy, and Poppins at
/usr/share/fonts/truetype/google-fonts/.
