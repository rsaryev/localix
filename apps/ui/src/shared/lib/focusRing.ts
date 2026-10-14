/**
 * Keyboard focus ring across the workspace's primary surfaces (F6 / ⇧F6).
 * The three surfaces of the
 * agentic development environment — the left sidebar (file tree / sections), the focused editor
 * group, and the chat composer — are marked in the DOM with a stable
 * `data-focus-part` attribute. F6 moves focus forward through whichever parts
 * are currently present; ⇧F6 backward. This is keyboard/accessibility plumbing:
 * it lets a keyboard-only user jump from typing a prompt to editing code and
 * back without reaching for the mouse.
 *
 * The parts advertise themselves — no component imports another (FSD-clean); the
 * DOM is the sole mediator. Only the pure `nextFocusPart` ordering is unit
 * tested; the DOM glue is thin.
 */

export type FocusPart = 'sidebar' | 'editor' | 'chat'

/** Ring order = spatial reading order across the workspace (left → right). */
export const FOCUS_RING: readonly FocusPart[] = ['sidebar', 'editor', 'chat']

/**
 * Given the parts currently present (in ring order) and the part that owns focus
 * now, return the next part to focus in `dir` (+1 forward, −1 back), cycling.
 * Returns null when there is nowhere useful to go (no parts, or the only present
 * part already owns focus).
 */
export function nextFocusPart(
  present: readonly FocusPart[],
  current: FocusPart | null,
  dir: 1 | -1,
): FocusPart | null {
  if (present.length === 0) return null
  if (present.length === 1) return present[0] === current ? null : present[0]
  const idx = current == null ? -1 : present.indexOf(current)
  if (idx === -1) return dir === 1 ? present[0] : present[present.length - 1]
  const n = present.length
  return present[(((idx + dir) % n) + n) % n]
}

/** Ordered focus-target selectors per part — the first match inside the part's
 *  container is the element we hand focus to. */
const PREFERRED: Record<FocusPart, string> = {
  // The composer is the point of the chat part; never grab the hidden file input.
  chat: 'textarea, [contenteditable="true"]',
  // Monaco's hidden textarea is its native keyboard/input focus target.
  editor: '.monaco-editor textarea, .xterm-helper-textarea, textarea, [contenteditable="true"]',
  // The tree: a selected row, else the filter box / first focusable control.
  sidebar:
    '[aria-selected="true"], [tabindex]:not([tabindex="-1"]), input:not([type="file"]):not([type="hidden"]), button:not([disabled]), a[href]',
}

function partContainer(part: FocusPart): HTMLElement | null {
  if (part === 'editor') {
    // Prefer the focused group so F6 lands in the editor the user last touched.
    return (document.querySelector('[data-focus-part="editor"][data-focus-active="true"]') ??
      document.querySelector('[data-focus-part="editor"]')) as HTMLElement | null
  }
  return document.querySelector(`[data-focus-part="${part}"]`) as HTMLElement | null
}

/** The part currently containing focus, or null if focus is outside the ring. */
export function currentFocusPart(): FocusPart | null {
  const active = document.activeElement as HTMLElement | null
  const host = active?.closest?.('[data-focus-part]') as HTMLElement | null
  const val = host?.getAttribute('data-focus-part')
  return val === 'sidebar' || val === 'editor' || val === 'chat' ? val : null
}

/** Parts present in the DOM right now, in ring order. */
export function presentFocusParts(): FocusPart[] {
  return FOCUS_RING.filter((p) => partContainer(p) != null)
}

function focusInto(part: FocusPart, container: HTMLElement): void {
  const target = container.querySelector(PREFERRED[part]) as HTMLElement | null
  if (target) {
    target.focus()
    return
  }
  // Nothing focusable inside (e.g. an empty editor group or a preview iframe):
  // make the container itself the focus sink so the ring never stalls.
  container.tabIndex = -1
  container.focus()
}

/** Move workspace focus one step through the ring. Wired to F6 / ⇧F6. */
export function focusPart(dir: 1 | -1): void {
  const present = presentFocusParts()
  const next = nextFocusPart(present, currentFocusPart(), dir)
  if (!next) return
  const container = partContainer(next)
  if (container) focusInto(next, container)
}
