import type { SessionMutationLock } from './session-access'
import type { CommandHandlerContext } from './command-handlers-context'
import type { ChatServiceDeps } from './context'
import type { createRunAgent } from './run-agent'
import type { ChatRepository, SessionRecord } from '../repository'
import type { createAgentRunner } from '../runtime/agent-runner'
import type { RunProfile } from '../../agent-core/run-shape'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { MessageBinding } from '../contracts'
import type { RunInvocation } from '../runtime/execution-context'
import type { AnswerPendingAsk } from './composer-ask-answer'
import type { ScopedCcHooks } from '../runtime/run-contract'

export interface TurnEntryContext {
  deps: ChatServiceDeps
  repo: ChatRepository
  runner: ReturnType<typeof createAgentRunner>
  streamRegistry: SessionStreamRegistry
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  publishSession: (session: SessionRecord) => void
  runAgent: ReturnType<typeof createRunAgent>
  /** The slash-command chain's context (control / plugin / skill handlers). */
  commandCtx: CommandHandlerContext
  withSessionMutationLock: SessionMutationLock
  /** A plain line typed while an `ask` card is open answers it (`composer-ask-answer.ts`). */
  answerPendingAsk?: AnswerPendingAsk
}

/** Options of an engine-dispatched job/subagent turn. */
export interface RunJobTaskOptions {
  invocation: Exclude<RunInvocation, { kind: 'root' }>
  extraDisabledTools?: string[]
  profileOverride?: RunProfile
  wait?: boolean
  bindings?: MessageBinding[]
  maxTurns?: number
  ccScopedHooks?: ScopedCcHooks[]
}
