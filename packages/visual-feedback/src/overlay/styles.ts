/**
 * The overlay's stylesheet, scoped to its own shadow root.
 *
 * The overlay used to be inline-styled divs in the page's light DOM, so the page's own rules
 * reached it: a global `div { transition: all .3s }` dragged the outline behind the cursor, and a
 * `* { box-sizing: content-box }` grew it by its border. Inside a shadow root only these rules apply.
 *
 * Timing mirrors the app's motion tokens (`--dur-fast` 150ms, `--dur-instant` 100ms, `--ease-soft`)
 * — the page cannot read the app's tokens, so the values are restated here. Only `transform` and
 * `opacity` animate; a box's size changes with its target and is not animated, so following an
 * element never lays the page out per frame.
 */
export const OVERLAY_CSS = `
:host { all: initial; }
.root { position: fixed; inset: 0; pointer-events: none; contain: strict; }
.box {
  position: fixed; left: 0; top: 0; box-sizing: border-box; display: none;
  border-radius: 4px; pointer-events: none; will-change: transform;
}
.box[data-on] { display: block; }
.hover {
  border: 2px solid var(--vf-accent, #4c8bf5);
  background: color-mix(in oklch, var(--vf-accent, #4c8bf5) 8%, transparent);
  box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 0 0 2.5px rgba(255,255,255,.6),
    0 2px 12px -3px color-mix(in oklch, var(--vf-accent, #4c8bf5) 55%, transparent);
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hover[data-marked] { border-style: dashed; }
.active {
  border: 2px solid var(--vf-accent, #4c8bf5);
  box-shadow: 0 0 0 1.5px rgba(0,0,0,.5), 0 0 0 3.5px rgba(255,255,255,.65),
    0 0 0 5px color-mix(in oklch, var(--vf-accent, #4c8bf5) 30%, transparent),
    0 6px 20px -6px color-mix(in oklch, var(--vf-accent, #4c8bf5) 60%, transparent);
}
.active[data-enter] { animation: vf-enter 150ms cubic-bezier(0.22, 1, 0.36, 1); }
.active[data-pulse]::after {
  content: ''; position: absolute; inset: -2px; border-radius: 6px;
  border: 2px solid var(--vf-accent, #4c8bf5);
  animation: vf-pulse 600ms cubic-bezier(0.22, 1, 0.36, 1) 2;
}
.marquee {
  border: 1.5px dashed var(--vf-accent, #4c8bf5);
  background: color-mix(in oklch, var(--vf-accent, #4c8bf5) 8%, transparent);
}
.mark {
  border-radius: 3px;
  border: 1px solid color-mix(in oklch, var(--vf-accent, #4c8bf5) 55%, transparent);
  background: color-mix(in oklch, var(--vf-accent, #4c8bf5) 12%, transparent);
  animation: vf-fade 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.label {
  position: fixed; left: 0; top: 0; display: none; max-width: min(320px, calc(100vw - 8px));
  padding: 3px 7px; border-radius: 5px; box-sizing: border-box;
  font: 500 11px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: var(--vf-accent-foreground, #fff); background: var(--vf-accent, #4c8bf5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 2px 8px rgba(0,0,0,.32);
  pointer-events: none; will-change: transform;
}
.label[data-on] { display: block; animation: vf-fade 100ms cubic-bezier(0.22, 1, 0.36, 1); }
.label b { font-weight: 700; margin-right: 4px; }
@keyframes vf-enter { from { opacity: 0; scale: 0.985; } to { opacity: 1; scale: 1; } }
@keyframes vf-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes vf-pulse { from { opacity: .9; scale: 1; } to { opacity: 0; scale: 1.06; } }
@media (prefers-reduced-motion: reduce) {
  .box, .label { transition: none !important; animation: none !important; }
  .active[data-pulse]::after { animation: none; display: none; }
}
`
