/**
 * Value-Budgeted Context Compression (VBC) — pure, model-agnostic machinery that
 * chooses a per-message compression operation to fit a token budget while
 * minimizing task-value loss. See plan.ts for the entry point.
 *
 * The list is what a host reads; everything else stays inside the package.
 */
export { READ_RESULT_TOOLS, registerContextToolClasses } from './tool-classes'
export {
  IMAGE_TOKEN_ESTIMATE,
  estimateChatMessageTokens,
  estimateItemResultTokens,
  estimateMessagesTokens,
  estimateWireMessageSize,
  estimateWireMessageTokens,
  estimateWireSize,
} from './tokens'
export {
  DEFAULT_TOKEN_CALIBRATION,
  calibratedTokens,
  observeTokenCalibration,
  type TokenCalibration,
  type WireSizeSample,
} from './token-calibration'
export { ELISION_MARKER } from './compression-markers'
export { heavyMutateInputs } from './recoverable-content'
export { planContextCompression } from './plan'
export { applyPlan } from './apply'
export {
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  isCompressedContent,
  pruneWireMessages,
} from './prune-wire'
export {
  planCheckpoint,
  projectCheckpoint,
  type CheckpointEntry,
  type CheckpointReason,
  type ContextCheckpoint,
} from './checkpoint'
// Public like ELISION_MARKER: a host that highlights compressed content must ASK for the
// markers, not keep a hand-copied list of them in sync by comment.
export { CRUSH_MARKER } from './crushers'
