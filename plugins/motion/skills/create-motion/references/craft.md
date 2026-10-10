# Motion craft — numbers that hold up

Sources: Material 3 motion tokens and IBM Carbon motion (Apache-2.0), HyperFrames and Motion Canvas
docs (Apache-2.0 / MIT), Remotion's public guidance (paraphrased), subtitle reading-speed norms,
SMPTE safe areas. Treat ranges as starting points and judge the snapshots.

## Story and pacing

- Hook ≤ 3 s → reveal → 1–3 proof beats (4–6 s each for product shots) → payoff → end card.
- One idea per scene: one headline, one visual, one lead move.
- Beat 2–4 s; hero shot 3–5 s; end card lands and holds still ≥ 2.5 s.
- Hold after text settles ≥ max(1.2 s, 0.5 s + 0.3 s × words). Reading speed ≈ 2–3 words/s.
- Never cut mid-ease; let an arrival finish and rest ≥ 0.5 s before the next change.

## Type

- Hero 8–12% of frame height (≈ 10–12 `--u`), section title 5–7%, body 3.5–4.5%, never < 2.8%.
- 2–7 words per headline, ≤ 2 lines, line height 1.0–1.1, tracking −2 to −4% at hero size.
- Contrast ≥ 4.5:1 (prefer 7:1) against the pixels actually behind the text.
- Safe areas: title-safe 90% (5% margin each side), action-safe 93%; for social crops keep key
  content in the central 4:5.

## Easing and duration

| Use                                | Curve                                                          | Duration         |
| ---------------------------------- | -------------------------------------------------------------- | ---------------- |
| Hero arrival, line reveal          | expo.out ≈ cubic-bezier(0.16, 1, 0.3, 1)                       | 0.7–1.0 s        |
| UI-scale arrival                   | power3.out / Material standard (0.2, 0, 0, 1)                  | 0.4–0.6 s        |
| Move between two rests, camera     | power2.inOut (0.65, 0, 0.35, 1)                                | 0.6–1.2 s        |
| Exit                               | power3.in / Material emphasized-accelerate (0.3, 0, 0.8, 0.15) | ~65% of entrance |
| Overshoot landing (once per scene) | back.out(1.4–1.7)                                              | 0.6–0.9 s        |
| Continuous drift, tickers          | linear                                                         | whole shot       |

- Springs that read premium: damping ratio 0.8–1.0, ≤ 2–6% overshoot.
- Scale in perceptual (log) space when it changes a lot; linear scale looks like it slows.

## Stagger

- Characters 30–50 ms (short words only), words 80–120 ms, lines 200–300 ms, cards 60–100 ms.
- Keep the whole spread ≤ 0.8 s; with many items shrink the step. Under 20 ms reads as one move.

## Kinetic type

- Line mask reveal: each line from 110% below its mask to 0, expo.out 0.8 s, 0.22 s apart.
- Word rise: opacity 0→1 plus 0.3 em rise, 90 ms apart.
- Character scramble: seeded order, ≤ 8° rotation.
- Tracking open: letter-spacing from +0.2 em to final over 1–1.5 s, decelerate.
- Scale punch on the beat word only: 0.92 → 1.
- Marker or underline drawn after the line lands, ~0.45 s left to right.
- Typewriter by slicing the string (the caret follows the text); blink smoothly, not on/off.

## Camera and product shots

- A slow 2–5% push-in across a shot; parallax layers at 0.2× / 0.5× / 1×.
- Screenshot in a browser or device frame: radius 12–24 px, large soft shadow, 1 px light edge.
- Tilt 8–20° that settles to flat as the shot lands; zoom 1.6–2.5× into the detail over 0.8–1.2 s,
  dim the rest.
- Cursor: curved path, 0.4–0.8 s travel, settles ~150 ms before the click; click = press to 0.9 for
  80 ms plus a ripple 0 → 50 px, opacity 0.5 → 0 over 0.45 s; the UI answers within 0.1 s.

## Transitions and finish

- High-end: mask wipes (0.4–0.7 s), match cuts, scale-through, blur-through (8–20 px peak), hard
  cuts on the beat. Cheap: spins, page curls, star wipes, crossfades longer than 0.8 s.
- One or two transition kinds per film.
- Grain 2–8% held for a few frames; vignette ≤ 20% at the corners; glow only on the hero; one accent
  colour on a near-black or near-white base.

## Failure modes to catch in snapshots

Text overflowing or clipped; text below the minimum size; scenes shorter than their reading time;
everything moving at once; linear easing on spatial moves; three or more effects stacked; dead or
empty frames (the first frame should already show something); pops — an element jumping from
invisible to full opacity without a move; leftover sample copy; an end card that keeps moving.
