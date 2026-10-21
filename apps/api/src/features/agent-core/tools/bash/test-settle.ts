import type { BackgroundSettleWindow } from './bash-run-context'

/**
 * A settle window for tests that are not about the window: a background spawn returns on its
 * first quiet gap instead of sleeping the production 2–3 s minimum on every call.
 * `bash-background-settle.test.ts` pins the real window.
 */
export const FAST_SETTLE: BackgroundSettleWindow = { minMs: 0, maxMs: 300, quietMs: 50 }
