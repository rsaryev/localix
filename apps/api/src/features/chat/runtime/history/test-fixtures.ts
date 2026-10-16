/**
 * Shared fixtures for the history-strategy tests: persisted rows of known token weight and a
 * one-call `materialize` that runs the chat strategy on a bare frame (no intake, no hooks).
 *
 * Test support only — nothing under `history/` imports it at runtime.
 */
import type { PersistedMessage } from '../../contracts'
import { resolveContextBudgetFrame } from '../context-budget'
import type { ContextAnchorProof } from '../context-token-estimate'
import type { RuntimeSection } from '../../../agent-core/system-prompt-tail'
import type { ModelView } from '../model-view/view'
import { createChatHistoryRun, type ChatHistoryRunContext } from './chat-strategy'
import type { ChatTurnFrame } from './frame'

export function persistedRow(id: string, payload: Record<string, unknown>): PersistedMessage {
  return {
    id,
    sessionId: 's',
    userId: 'u',
    payload: { id, ...payload },
    createdAt: '',
    updatedAt: '',
  } as unknown as PersistedMessage
}

/** ~1k tokens of RECOVERABLE read output — the free layer may pointer-elide it. */
export function readMessage(i: number): PersistedMessage {
  return persistedRow(`m-${i}`, {
    role: 'assistant',
    content: '',
    items: [
      {
        type: 'tool_call',
        toolCallId: `t-${i}`,
        name: 'read',
        status: 'completed',
        input: { path: `/repo/src/file-${i}.ts` },
        resultText: `line ${i}\n`.repeat(400),
      },
    ],
  })
}

/** ~600 tokens of NON-recoverable bash output — only a binding budget can force it smaller. */
export function bashMessage(i: number): PersistedMessage {
  return persistedRow(`b-${i}`, {
    role: 'assistant',
    content: '',
    items: [
      {
        type: 'tool_call',
        toolCallId: `bt-${i}`,
        name: 'bash',
        status: 'completed',
        input: { command: `test ${i}` },
        resultText: `out ${i} xxxxxxxxxxxxxxxx\n`.repeat(300),
      },
    ],
  })
}

/** A turn frame with nothing volatile unless the test hands it runtime sections. */
export function bareFrame(
  messages: readonly PersistedMessage[],
  activeInvocationId?: string,
  runtimeSections: RuntimeSection[] = [],
  assistantMessageId = 'asst-test',
): ChatTurnFrame {
  return {
    messages,
    runtimeSections,
    systemBindings: [],
    activeInvocationId,
    assistantMessageId,
    assistantCreatedAt: '',
    sessionId: 's',
    userId: 'u',
    promptMessage: messages.at(-1),
    now: () => '',
  }
}

export interface MaterializeOptions {
  contextWindow?: number
  fixedOverheadTokens?: number
  activeInvocationId?: string
  recoveryToolAvailable?: boolean
  contextAnchorProof?: ContextAnchorProof
  media?: ChatHistoryRunContext['media']
  /** Reuse lane state across two calls. */
  state?: ChatHistoryRunContext['state']
  runtimeSections?: RuntimeSection[]
  /** The model view in force; default: a fresh conversation with nothing due. */
  view?: ModelView
  assistantMessageId?: string
}

export const freshLane = (): ChatHistoryRunContext['state'] => ({
  elidedToolCallIds: new Set(),
  elidedArgToolCallIds: new Set(),
})

export const freshView = (): ModelView => ({
  viewer: 'agent:default',
  turnContexts: new Map(),
  epochId: '',
})

export const TEST_IDENTITY = {
  providerId: 'openai',
  modelId: 'gpt',
  systemPromptHash: 'system',
  toolSchemaHash: 'tools',
} as const

export async function materializeChat(
  history: readonly PersistedMessage[],
  options: MaterializeOptions = {},
) {
  const frame = resolveContextBudgetFrame({
    contextWindow: options.contextWindow,
    fixedOverheadTokens: options.fixedOverheadTokens,
  })
  const state = options.state ?? freshLane()
  if (options.contextAnchorProof) state.contextAnchorProof = options.contextAnchorProof
  const run = createChatHistoryRun({
    sessionId: 's',
    frame,
    identity: TEST_IDENTITY,
    view: options.view ?? freshView(),
    media: options.media ?? {},
    state,
    recoveryToolAvailable: options.recoveryToolAvailable ?? true,
    recallToolAvailable: true,
  })
  return run.materialize(
    bareFrame(
      history,
      options.activeInvocationId,
      options.runtimeSections,
      options.assistantMessageId,
    ),
    new AbortController().signal,
  )
}
