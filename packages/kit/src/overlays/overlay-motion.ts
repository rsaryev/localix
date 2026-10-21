/**
 * How an overlay ENTERS and LEAVES — one answer for every popover, menu, hover card, tooltip,
 * dialog and scrim.
 *
 * The defect this module exists to stop: the same fade + zoom was transcribed into seven primitives
 * in two variant spellings (`data-open:` and `data-[state=open]:`), each with its own literal
 * `duration-100`. Nothing tied them together, so retiming one surface left the others where they
 * were, and an overlay's entrance depended on which primitive happened to render it.
 *
 * `data-open:` / `data-closed:` are shadcn's variants and match BOTH Radix's `[data-state=open]`
 * and a bare `[data-open]`, so one spelling covers every Radix family here. The tooltip is the
 * exception it cannot cover: its open state is `delayed-open` / `instant-open`, so it animates on
 * mount and gates only the exit.
 *
 * The duration is `--dur-instant` (100ms): an overlay is a response to a click, and anything slower
 * reads as lag rather than motion. Slide distance is by weight — a root panel travels `-2`, a
 * label-sized or nested one (tooltip, hover card, sub-menu) `-1`.
 */

/** Fade + settle from 95% for a floating panel or a modal card. */
export const OVERLAY_ENTER_EXIT =
  'duration-(--dur-instant) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'

/**
 * A modal card arriving: it rises a little out of a blur and settles, and its regions (hero,
 * header, body, footer) follow in order. Slower than a popover on purpose — a dialog interrupts,
 * and its arrival is the one moment the person is looking for it. Keyframes and timing live in
 * `styles/motion.css` (`lx-modal-motion`). Keyboard-summoned surfaces (the command palette, a
 * pane quick pick) keep `OVERLAY_ENTER_EXIT`: they answer a keystroke and must not lag it.
 */
export const MODAL_ENTER_EXIT = 'lx-modal-motion'

/** Fade only — for a scrim, whose job is to dim, not to arrive from somewhere. */
export const SCRIM_ENTER_EXIT =
  'duration-(--dur-instant) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0'

/** Media viewers keep their backdrop still while the content owns its own transitions. */
export const OVERLAY_NO_MOTION = 'data-open:animate-none data-closed:animate-none'

/** The tooltip's own gate: enter on mount (its open state is never plain "open"), exit on close. */
export const TOOLTIP_ENTER_EXIT =
  'duration-(--dur-instant) animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'

/** Travel away from the anchor, by the panel's weight. */
export const OVERLAY_SLIDE = {
  near: 'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
  far: 'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
} as const
