/**
 * `@localixai/agent/history` — the stage engine a host's history strategy builds on.
 *
 * The host owns the strategy (where the repositories are); this subpath ships the pure
 * pipeline that runs its stages and the reports it files. Nothing here knows a database or a
 * provider.
 */
export type { HistoryDropReason, StageReport, TurnFrame } from './types'
export type { HistoryStage, StageContext, StageOutcome } from './stage'
export { runHistoryStages } from './pipeline'
export type { PipelineOptions, PipelineResult } from './pipeline'
