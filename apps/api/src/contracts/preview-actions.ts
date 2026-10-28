/**
 * Browser-safe leaf for the `Browser` tool's action vocabulary.
 *
 * `BrowserAction` is the union the tool card keys its presentation map on
 * (`Record<BrowserAction, string>`). Its AUTHORITY is the tool's own `ACTIONS` tuple in
 * `agent-core` (browser-actions.ts), which also feeds the zod schema — so this
 * is a genuine single source, not a hand-mirror: add an action there and every
 * `Record<BrowserAction, …>` in the UI stops compiling until it is handled.
 *
 * This is a TYPE-ONLY re-export: the underlying module pulls zod + the probe graph at
 * runtime, but `export type` is fully elided by the bundler, so nothing server-side
 * reaches the UI bundle.
 */
export type { BrowserAction } from '../features/agent-core/tools/browser/browser-input'
