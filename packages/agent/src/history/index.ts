/**
 * `@localixai/agent/history` — the history port and the pure mechanisms behind it.
 *
 * Hosts implement `HistoryStrategy` here-typed and register it; the SDK ships the stage
 * engine and the value-level helpers (JSON extraction) a strategy builds on. Nothing in this
 * subpath knows a database or a provider.
 */
export type {
  BudgetFrame,
  ContextEstimate,
  HistoryDropReason,
  HistoryRun,
  HistoryRunContext,
  HistoryStrategy,
  HistoryStrategyRegistry,
  MaterializeInput,
  MaterializeResult,
  StageReport,
  TurnFrame,
} from './port'
export { appendStage, mapStage } from './stage'
export type { HistoryStage, StageContext, StageOutcome } from './stage'
export { pipelineSavings, runHistoryStages } from './pipeline'
export type { PipelineOptions, PipelineResult } from './pipeline'
export { extractJsonBlock, jsonCandidates } from './extract-json-block'
export type { ExtractedJson } from './extract-json-block'
