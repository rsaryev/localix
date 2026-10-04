/**
 * Deterministic context checkpoints: how a conversation longer than its window keeps going
 * without a model call — a frozen view, rewritten only at rare checkpoints, append-only between.
 */
export type {
  CheckpointEntry,
  CheckpointReason,
  ContextCheckpoint,
  EpochCard,
  FrozenToolOp,
  FrozenTransform,
} from './types'
export { planCheckpoint, type PlanCheckpointInput } from './plan'
export { projectCheckpoint, type ProjectCheckpointOptions } from './project'
export { stripReasoning, type TransformFlags } from './transforms'
