import type { AgentMessage } from '@localixai/agent/agents'
import type { RuntimeContextPolicy } from '@localixai/agent/runtime'
import type {
  CheckpointReason,
  ContextCheckpoint,
  TokenCalibration,
  WireSizeSample,
} from '@localixai/agent'
import type { StageReport } from '@localixai/agent/history'

import type { PersistedMessage } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db/payload'
import type { MediaStore } from '../../../media/store'
import type { DocumentTextExtractor } from '../../../agent-core/tools/file/document-ports'
import type { ContextBudgetFrame } from '../context-budget'
import type { ContextAnchorIdentity, ContextAnchorProof } from '../context-token-estimate'
import type { StoredTurnContext } from '../model-view/turn-context'
import type { ModelView } from '../model-view/view'
import type { ChatTurnFrame } from './frame'
import type { ElisionLedger } from './request-transform'

/**
 * A FORK's first run: it continues its parent's conversation, and the one thing it adds is the
 * directive. Its request must be the parent's last request plus the call and that directive
 * (`run/fork`), so it takes no runtime context of its own — the parent's was sent already — and
 * its cache breakpoint sits where the parent's request ended.
 */
export interface ForkHistory {
  /** The parent's call that made the fork. */
  toolCallId: string
  /** No run of the fork has answered yet. Later runs are ordinary ones over a longer history. */
  first: boolean
}

export interface ChatHistoryRunContext {
  sessionId: string
  frame: ContextBudgetFrame
  /** For the anchor identity: which provider/model, and the hashes of the fixed prefix. */
  identity: {
    providerId: string
    modelId: string
    systemPromptHash: string
    toolSchemaHash: string
  }
  /**
   * The tool names this run is actually holding: past tool work in tools it no longer holds reads
   * as historical observation. Absent means "do not gate".
   */
  availableTools?: ReadonlySet<string>
  /** The frozen view in force and whether this turn re-plans it (`model-view/view.ts`). */
  view: ModelView
  recoveryToolAvailable?: boolean
  /** Set on a fork's runs (`ForkHistory`). */
  fork?: ForkHistory
  /** Is `GlobalSearch` in the roster? Cards and folds point at it only when it is. */
  recallToolAvailable?: boolean
  /** What this model has taught about the heuristic so far; prices appended messages. */
  calibration?: TokenCalibration
  media: {
    mediaStore?: MediaStore
    defaultCwd?: string
    extractDocument?: DocumentTextExtractor
    acceptsImages?: boolean
  }
  /** Session-scoped state, owned by the host and reused across runs. */
  state: {
    contextAnchorProof?: ContextAnchorProof
    /** Set by the per-request policy when it had to prune; the next turn checkpoints. */
    checkpointDue?: CheckpointReason
  } & ElisionLedger
}

export interface ChatMaterializeResult {
  wire: AgentMessage[]
  /** The bounded persisted history the wire was derived from (the finalizer reads it). */
  effectiveHistory: PersistedMessage[]
  payloads: StoredMessagePayload[]
  estimate: { tokens: number; source: 'provider_anchor' | 'heuristic'; trailingTokens?: number }
  identity: ContextAnchorIdentity
  reports: StageReport[]
  /** This turn's runtime context, for the run to persist on its assistant row. */
  turnContext?: StoredTurnContext
  /** The checkpoint this turn took, for the run to persist before it sends. */
  checkpoint?: ContextCheckpoint
}

/** One run's history handling: both halves over one frame. */
export interface ChatHistoryRun {
  materialize(frame: ChatTurnFrame, signal: AbortSignal): Promise<ChatMaterializeResult>
  requestPolicy(init: {
    initialEstimate: ChatMaterializeResult['estimate']
  }): RuntimeContextPolicy & {
    /** The wire the provider's next usage will measure. */
    lastWireSample?: () => WireSizeSample | undefined
  }
}
