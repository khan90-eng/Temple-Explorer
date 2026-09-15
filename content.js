// Temple Explorer — Session 6 waypoint content
//
// Each entry below places a small white dot in the 3D scene. Nothing is
// labelled on screen — the dot just brightens when you aim at it. Left-click
// unrolls that checkpoint's scroll, right-click (or Escape) closes it.
//
// `page` is the scroll artwork in assets/scrolls/, shown full-bleed in the
// book — the page IS the image, there is no separate on-screen text. Three of
// them (front wall, horus, hieroglyphics) are Provat's own scrolls from his
// animation, used unchanged. The other six were built on 14 Sep from the same
// parchment: the blank plate was lifted out of his wall-comparison scroll, the
// wording came from his textbook page plus web research, and every
// illustration is a frame from his own Temple of Horus.mp4 — no outside
// imagery. See scrolls/compose.py in the scratch work for how they are made;
// to reword one, edit that script and re-render rather than editing the image.
//
// IMPORTANT — how `offset` works:
// It is measured FROM THE SPAWN POINT, in metres, not in the model's own raw
// coordinates. The spawn point is not at coordinate zero, so raw coordinates
// here would land the marker in the wrong place entirely (that exact mistake
// put every marker 100+ m away and invisible on the first try, 13 Sep).
//   x — sideways: + is right of the spawn-facing direction, - is left
//   y — height:   1.6 = eye height off the floor at spawn
//   z — depth:    NEGATIVE goes INTO the temple, positive goes back outwards
// These are the same numbers the bottom-left readout prints in-game, and the
// same convention the Session 5 minimap was calibrated in (gate = z -41,
// sanctuary = z -159), so a reading can be pasted straight in below.
//
// POSITIONS ARE MEASURED, not guessed — Provat placed all nine in-game on
// 14 Sep with placement mode, aiming at the actual object each one belongs
// to, so they sit ON the pylon gateway, the columns, the front wall, the
// shrine, and so on. Several are well above eye level because that is where
// the feature is; that is intentional, not an error.
//
// TO MOVE ONE, or to add the two offering rooms: press M in-game for
// placement mode, [ / ] to select, aim, P to drop, O to copy them all out.
//
// An optional `morePage` adds a second scroll, reached by left-clicking
// again — that is what the "...More Info" line on Provat's Horus scroll
// points at. No second page has been supplied for it yet.
//
// CHECKPOINTS IN Temple of Horus.mp4 (full pass, 160 s) — `video:` on each
// entry below points at its moment in that file:
//   0-11 s    title "TEMPLE OF HORUS, EGYPT" over the aerial approach
//   13-16 s   plan locator scroll, dot at the entrance
//   17-21 s   title "CENTRAL COURTYARD"
//   40-43 s   SCROLL CARD: wall construction comparison (+ plan locator)
//   48-52 s   SCROLL CARD: Horus / Eye of Horus, carries "...More Info"
//   60-61 s   plan locator scroll
//   62-65 s   title "HYPOSTYLE HALL"
//   79-82 s   title "INNER COURT"
//   99-102 s  title "CHAPELS" (+ plan locator)
//  140-144 s  title "ARK OF HORUS" (+ plan locator)
//  149-153 s  SCROLL CARD: Hieroglyphics
//  155-160 s  "THANK YOU"
// Only those three scroll cards carried real paragraphs; every other
// checkpoint was a bare title overlay, which is why the other six pages had
// to be written. There is no columns card and no offering-rooms checkpoint
// anywhere in the video.

export const hotspots = [
  {
    // video: 0-11 s (title card over the aerial approach)
    id: 'pylon',
    title: 'The Pylon',
    page: 'scroll-pylon.webp',
    offset: { x: -3.6, y: 6.2, z: -41.0 },
  },
  {
    // video: 40-43 s (scroll card)
    id: 'front-wall',
    title: 'Front Wall Construction',
    page: 'scroll-front-wall.webp',
    offset: { x: -8.2, y: 5.6, z: -104.0 },
  },
  {
    // video: 17-21 s (title card)
    id: 'courtyard',
    title: 'Central Courtyard',
    page: 'scroll-courtyard.webp',
    offset: { x: 4.1, y: 2.0, z: -75.0 },
  },
  {
    // video: 48-52 s (scroll card, the one with "...More Info")
    id: 'horus-statue',
    title: 'Horus, the Falcon God',
    page: 'scroll-horus.webp',
    offset: { x: 8.7, y: 2.0, z: -101.1 },
  },
  {
    // video: 62-65 s (title card)
    id: 'hypostyle-hall',
    title: 'Hypostyle Hall',
    page: 'scroll-hypostyle.webp',
    offset: { x: 3.3, y: 13.6, z: -121.8 },
  },
  {
    // video: 79-82 s (title card)
    id: 'inner-court',
    title: 'Inner Court',
    page: 'scroll-inner-court.webp',
    offset: { x: 3.9, y: 2.0, z: -146.9 },
  },
  {
    // video: 99-102 s (title card)
    id: 'chapels',
    title: 'Chapels',
    page: 'scroll-chapels.webp',
    offset: { x: -15.5, y: 2.6, z: -157.2 },
  },
  {
    // video: 140-144 s (title card "ARK OF HORUS")
    id: 'sanctuary',
    title: 'Sanctuary — Ark of Horus',
    page: 'scroll-sanctuary.webp',
    offset: { x: 3.6, y: 3.5, z: -164.1 },
  },
  {
    // video: 149-153 s (scroll card)
    id: 'hieroglyphics',
    title: 'Hieroglyphics',
    page: 'scroll-hieroglyphics.webp',
    offset: { x: 8.7, y: 9.2, z: -166.0 },
  },

  // Offering rooms: intentionally left out for now. No title card appeared
  // for them anywhere in the walkthrough video, so rather than guess two
  // more positions, add them once you can point out the exact spot in-game
  // (walk there, read the numbers off the readout, same as the others).
];
