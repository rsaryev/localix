/**
 * The model-facing name of the picture action. The probe relay keeps its own `screenshot`
 * command (the manual Visual Feedback picker sends it too, with no agent involved), so the tool
 * vocabulary and the relay protocol meet in one place: `buildPreviewCommand`. `take_screenshot`
 * is the name agent browsers already teach models (Playwright MCP's `browser_take_screenshot`).
 */
export const TAKE_SCREENSHOT = 'take_screenshot'

// The top-level actions the schema offers, and the ONLY ones execute accepts. Interactions
// (click/type/press/scroll/hover) are not here: they are step shapes inside `steps`, so the
// schema carries that vocabulary once instead of twice.
export const ACTIONS = [
  'viewport',
  'open',
  'close',
  'snapshot',
  TAKE_SCREENSHOT,
  'console',
  'evaluate',
  'history',
  'steps',
  // The decision model drives the tab toward a stated sub-goal (`browser-goal.ts`).
  'goal',
] as const

/** The interactions, which exist only as steps. */
export const INTERACTIONS = ['click', 'type', 'press', 'scroll', 'hover'] as const

// Interactions PLUS the read actions snapshot/evaluate/console, so a batch can act THEN
// observe in one call (e.g. click a toggle then snapshot the new page, or evaluate the
// resulting `data-theme`). The probe dispatcher already runs each step generically — this
// enum is the only gate; a trailing `snapshot` step returns the fresh tree.
export const STEP_ACTIONS = [...INTERACTIONS, 'snapshot', 'evaluate', 'console'] as const

export type BrowserAction = (typeof ACTIONS)[number]

/**
 * Actions that only OBSERVE — the `view` half `classifyBrowserCall` reports, which is what
 * lets a run (a plan session included) look at the app without a rule confirming every
 * glance — while still confirming the actions that DRIVE it.
 *
 * It lives here, beside `ACTIONS`, because this file is the owner of the action vocabulary: a new
 * action added above and forgotten here is classified `external`, which is the safe default the
 * classifier contract asks for.
 */
export const OBSERVING_ACTIONS: ReadonlySet<BrowserAction> = new Set<BrowserAction>([
  'viewport',
  'snapshot',
  TAKE_SCREENSHOT,
  'console',
  // Re-points the preview pane at a URL and runs nothing; the snapshot actions have nothing to
  // observe until one of these has run.
  'open',
  'close',
])
