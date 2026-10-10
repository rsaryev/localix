# Motion film — agent guide

This folder is a [HyperFrames](https://hyperframes.heygen.com) project forked from a Localix motion
direction. It already plays that direction's sample film. Keep what serves the brief, replace the
story, add or remove scenes freely. You edit it like code; Localix previews it live in **Motion
Studio**.

**Direction:** `DIRECTION.md` holds the rules for this film (palette, type, motion, composition,
transitions, what to avoid) and `blocks/style.css` its tokens. Follow them in every scene; use the
`--mk-*` variables instead of literal colours so `motion_studio restyle` can move the whole film to
another direction.

When HyperFrames skills are installed (`/hyperframes`, `/hyperframes-core`,
`/hyperframes-animation`), load them for the full contract. This file is the short version plus the
Localix blocks.

## Loop

1. Fill `BRIEF.md` and `STORYBOARD.md` from real sources. Never invent claims, figures or quotes.
2. `motion_studio import` the logo, screenshots, video and audio; reference them as `assets/<file>`.
3. Edit one scene at a time with small edits. Keep IDs and timeline keys consistent.
4. Sample copy carries a `data-sample` attribute: replace the text and remove the attribute.
5. `motion_studio check` after each round (`deep: true` for the browser check of layout, contrast
   and runtime errors). Fix everything it reports, including leftover sample copy.
6. `motion_studio snapshot` at each scene's midpoint and end, then **look at the PNGs**
   (`snapshots/contact-sheet.jpg`). Fix what you see and snapshot again.
7. `motion_studio render` only when the person asks.

## Structure

```text
index.html               root: scene slots on the timeline + transitions between them
compositions/<scene>.html one scene per file, wrapped in <template>
compositions/finish.html  grain + vignette over the whole film
blocks/motion-kit.css     tokens and static components (mk-*)
blocks/style.css          the direction's token overrides (palette, type, radius, grain, curves, tempo)
blocks/motion-kit.js      MK.* seek-safe animation helpers
DIRECTION.md              the direction's rules to follow
assets/                   media
```

### Timing

- A scene slot in `index.html` has `data-start`, `data-duration`, `data-composition-id` and
  `data-composition-src`. Its scene file's root uses the same `data-composition-id` and registers
  `window.__timelines['<id>']`.
- Scenes overlap by their transition (0.4–0.7 s). The root `data-duration` equals the last scene's
  end. When you retime a scene, move the following slots and the `MK.transition` times too.
- Inside a scene, times are local to the scene (0 = when it starts).
- Paint order follows the slots: give each later scene a higher `data-track-index` (or a higher
  `z-index`) so an incoming scene wipes in over the outgoing one.

### Contract (breaking any of these breaks the render)

- One `gsap.timeline({ paused: true })` per composition, registered **after** its tweens. Build
  inside `document.fonts.ready.then(...)` when you split or measure text.
- No `Math.random` (use `MK.random(seed)`), `Date`, `performance.now`, timers,
  `requestAnimationFrame`, `.play()`, CSS `animation`/`transition` or `repeat: -1`.
- Clips are `display: none` until their start and the runtime seeks before showing them: read layout
  only at build time, inside `MK.withLayout(el, fn)`, using `MK.offsetWithin(el, parent)`.
- Never tween `visibility`, `display` or `autoAlpha` on a `.clip` or scene root; animate a child.
- Never set a CSS `transform` on an element you also tween with GSAP: use `fromTo`.
- Styles and scripts of a scene live **inside** its `<template>`. Prefix IDs with the scene ID.
- Size with `--u` (1% of the frame's short edge) so the film survives a format change; layout with
  flex/grid inside `mk-center` / the safe margin, not absolute pixel offsets.

## Blocks

CSS (`blocks/motion-kit.css`) — build the end state with these:

| Class                                                                 | Use                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `mk-scene`, `mk-center`                                               | full-frame scene; centred content inside the 5% safe margin                         |
| `mk-hero`, `mk-title`, `mk-body`, `mk-label`, `mk-accent`             | type scale (hero 11u, title 6.5u, body 3.8u, label 2.6u)                            |
| `mk-browser` (+ `-bar`, `-url`, `-body`)                              | browser frame for a screenshot (`<img src="assets/…">` in the body) or an HTML mock |
| `mk-cursor` + an SVG arrow                                            | product-demo cursor (drive with `MK.cursorPath`, `MK.click`)                        |
| `mk-card`, `mk-pill`, `mk-kbd`                                        | UI furniture                                                                        |
| `mk-stat`, `mk-bars` / `mk-bar` / `mk-bar-fill` (`--v: 0..1`)         | figures and bar charts                                                              |
| `mk-caption`, `mk-lower-third`                                        | caption box (TikTok style), name/title strap                                        |
| `mk-gridlines`, `mk-dots`, `mk-glow`, `mk-starburst`, `mk-light-leak` | backgrounds and light                                                               |
| `mk-grain` (SVG turbulence), `mk-vignette`                            | finishing, already in `finish.html`                                                 |

JS (`blocks/motion-kit.js`) — each helper adds tweens to `tl` at time `at` and returns what it made:

```js
MK.revealLines(tl, '#title', 0.2, { stagger: 0.22, exitAt }) // lines rise out of masks
MK.revealWords(tl, '#line', 0.4) // words fade up, 90 ms apart
MK.revealChars(tl, '#name', 0.6, { seed: 3 }) // chars land; seed scrambles order
MK.typewriter(tl, '#query', 0.5, { cps: 24 }) // add <span class="mk-caret">▌</span> after it
MK.counter(tl, '#stat', 1, { to: 128, suffix: '%', decimals: 0 })
MK.wordCarousel(tl, '#word', ['speed', 'teams', 'focus'], 0.4, { hold: 0.8 })
const t = MK.cursorPath(
  tl,
  '#cursor',
  () => [
    { x, y },
    { x, y, travel: 0.8 },
  ],
  1.6,
) // returns arrival
MK.click(tl, '#cursor', t - 0.3) // press + ripple
MK.annotate(tl, '#stat', 3.8, { kind: 'circle' }) // underline | box | circle | strike | marker
MK.drawPath(tl, '#logo-path', 0.3, 1.2) // SVG line draw-on
MK.bars(tl, '#chart', 0.5) // bars grow, staggered
MK.pushIn(tl, '#stage', 0, sceneDuration, { to: 1.04 }) // slow camera push
MK.transition(tl, 'wipe' | 'iris' | 'blur' | 'zoom' | 'slide' | 'fade', '#from', '#to', at, {
  duration: 0.6,
})
;MK.ease.enter | soft | move | exit | pop | drift // the direction's curves
MK.dur(0.8) // seconds × the direction's tempo
```

More blocks (charts, maps, shader transitions, captions, overlays): `npx hyperframes catalog` and
`npx hyperframes add <name>` (see the `/hyperframes-registry` skill).

## Craft

- **Story:** hook (≤ 3 s) → reveal → one to three proof beats (product doing the thing, real
  numbers) → end card. One idea per scene; the viewer gets it without sound.
- **Timing:** beats 2–4 s, hero shots 3–5 s. After text lands, hold ≥ 0.5 s + 0.3 s per word. The
  end card lands, then holds still ≥ 2.5 s. Never cut in the middle of an ease.
- **Type:** headline 2–7 words, ≤ 2 lines, tracking −2 to −4% at hero size; body ≥ 3.6u; labels
  tracked caps. Contrast ≥ 4.5:1 on the actual background. Keep text inside the safe margin.
- **Motion:** `expo.out` arrivals (0.6–0.9 s), `power3.in` exits at ~65% of the entrance,
  `power2.inOut` moves, linear only for drift. Stagger words 80–120 ms, characters 30–50 ms, lines
  200–300 ms; keep a stagger's spread under ~0.8 s. One overshoot (`MK.ease.pop`) per scene at most.
  Never move everything at once: one lead move, then supporting moves.
- **Product:** show the real UI (imported screenshot in `mk-browser`), tilt 8–15° that settles flat,
  zoom 1.6–2× into the detail that matters, cursor on a curve that settles before it clicks, the UI
  answers within 0.1 s. Annotate the one number that proves the point.
- **Transitions:** one or two kinds per film (a wipe family plus blur-through for big turns). No
  spins, page curls or long crossfades.
- **Finish:** grain ≤ 8%, soft vignette, glow only on the hero element; a 2–5% push-in keeps every
  shot alive. One accent colour; neutrals do the work.
