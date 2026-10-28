import type { AgentItemStatus } from '@localixai/agent/agents'
import type { SessionRecord } from '../../repository'
import type { RunTurnState } from './turn-state'
import type { RunEnv } from './types'

/** Run identity and host ports shared by action registration and background publication. */
export interface RunAsyncRegistryArgs {
  env: RunEnv
  state: RunTurnState
  abort: AbortController
  userId: string
  session: SessionRecord
  /**
   * The agent whose run this is: a job's mid-run note and its exit notice go back to it.
   */
  agentId: string
  assistantMessageId: string
  /** Tool names that declared `background: true` — drives stream-job detection generically. */
  backgroundToolNames: ReadonlySet<string>
  /** Final model roster result for context-recovery reminder wording. */
  recoveryToolAvailable?: boolean
  /** Keep a live row's accumulator in sync so a later model delta cannot restore stale output. */
  patchLiveItem?: (
    toolCallId: string,
    patch: { status?: AgentItemStatus; details?: unknown; resultText?: string },
  ) => void
}
