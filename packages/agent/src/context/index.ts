/**
 * Value-Budgeted Context Compression (VBC) — pure, model-agnostic machinery that
 * chooses a per-message compression operation to fit a token budget while
 * minimizing task-value loss. See plan.ts for the entry point.
 */
export * from './boundary'
export * from './tool-classes'
export { normalizePathKey } from './path-key'
export * from './tokens'
export * from './token-calibration'
export * from './entities'
export * from './targets'
export * from './dep-graph'
export * from './value'
export * from './op-menu'
export * from './op-floor'
export * from './allocator'
export * from './plan'
export * from './apply'
export * from './prune-wire'
export * from './live-reads'
export * from './pointers'
export * from './vocab-hints'
export * from './file-ops'
export * from './checkpoint'
// The third compression marker (the other two ride op-menu/prune-wire). Public for the
// same reason they are: a host that highlights compressed content must ASK for the
// markers, not keep a hand-copied list of them in sync by comment.
export { CRUSH_MARKER } from './crushers'
