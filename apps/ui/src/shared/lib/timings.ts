/**
 * Repeated UI feedback timings. One name per role so the same confirmation lasts the same time
 * wherever it appears.
 */

/** Compact controls (editor toolbars, cell viewer): a quick tick. */
export const COPIED_FEEDBACK_SHORT_MS = 1200
/** The default "Copied" confirmation. */
export const COPIED_FEEDBACK_MS = 1500
/** Content-sized copy targets (code blocks, diagrams, messages, images): a longer tick. */
export const COPIED_FEEDBACK_LONG_MS = 1800
