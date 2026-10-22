import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  ElicitRequestSchema,
  type ElicitRequest,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { AgentToolExecutionContext } from '@localixai/agent/agents'

import { hitlDecisionDeadline } from '../agent-core/tools/hitl/decision-deadline'
import type {
  McpElicitationAnswer,
  McpElicitationHookCarrier,
  McpElicitationHookRequest,
  McpElicitationRequest,
  McpElicitationResponse,
  McpElicitationSchema,
} from '../agent-core/tools/hitl/mcp-elicitation'
import { validateElicitationContent } from '../agent-core/tools/hitl/mcp-elicitation-content'

/**
 * MCP ELICITATION: a server asks the person for input in the middle of a tool call, as Claude Code
 * lets it. The client offers the `elicitation` capability (form and URL modes) and answers each
 * `elicitation/create` with a card in the chat whose call the server is serving.
 *
 * Clients are shared across chats, so the protocol alone cannot say which chat asked: a request
 * carries no link to the call it serves. The call registers itself on its client while it runs
 * ({@link withElicitationRoute}); a request goes to the latest call still running on that client.
 * With no call running, nobody can be asked, and the request is cancelled.
 *
 * Order, as in Claude Code: the `Elicitation` hooks may answer first (no card); otherwise the card
 * waits up to the HITL deadline, and the `ElicitationResult` hooks may then replace or block the
 * person's answer. Whatever comes back is checked against the requested form before the server
 * sees it; content that does not fit declines.
 */

export interface ElicitationCall {
  /** The server as Claude Code names it — hook matchers and `mcp_server_name` read this. */
  server: string
  /** The name the person configured, shown on the card. */
  displayName: string
  toolCallId: string
  context?: AgentToolExecutionContext & McpElicitationHookCarrier
  signal?: AbortSignal
  /** Stops the call's own timeout while the person answers; returns the resume. */
  hold?: () => () => void
}

type ElicitParams = ElicitRequest['params']
type Logger = { warn(msg: string): void }

const callsByClient = new WeakMap<object, ElicitationCall[]>()

/** Run `work` as `call` on `client`: an elicitation that arrives meanwhile is asked in its chat. */
export async function withElicitationRoute<T>(
  client: object,
  call: ElicitationCall,
  work: () => Promise<T>,
): Promise<T> {
  const calls = callsByClient.get(client) ?? []
  calls.push(call)
  callsByClient.set(client, calls)
  try {
    return await work()
  } finally {
    const index = calls.indexOf(call)
    if (index >= 0) calls.splice(index, 1)
  }
}

function hookRequest(call: ElicitationCall, params: ElicitParams): McpElicitationHookRequest {
  const mode = params.mode === 'url' ? 'url' : 'form'
  return {
    server: call.server,
    message: params.message,
    mode,
    ...('requestedSchema' in params && params.requestedSchema
      ? { requestedSchema: params.requestedSchema as McpElicitationSchema }
      : {}),
    ...('url' in params && typeof params.url === 'string' ? { url: params.url } : {}),
    ...('elicitationId' in params && typeof params.elicitationId === 'string'
      ? { elicitationId: params.elicitationId }
      : {}),
  }
}

/** Only an accepted form carries content, and only content its form allows reaches the server. */
function checked(
  request: McpElicitationHookRequest,
  answer: McpElicitationAnswer,
  logger?: Logger,
): ElicitResult {
  if (answer.action !== 'accept') {
    return answer.content && answer.action === 'cancel'
      ? { action: 'cancel', content: answer.content }
      : { action: answer.action }
  }
  if (request.mode === 'url') return { action: 'accept' }
  const check = validateElicitationContent(request.requestedSchema, answer.content ?? {})
  if (check.ok) return { action: 'accept', content: check.content }
  logger?.warn(
    `MCP elicitation from "${request.server}" declined: the answer does not fit its form (${Object.keys(check.errors).join(', ')})`,
  )
  return { action: 'decline' }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

/** Raise the card in the asking chat and wait; silence, a dismissal or a stop is a cancel. */
async function askPerson(
  call: ElicitationCall,
  request: McpElicitationHookRequest,
  signal?: AbortSignal,
): Promise<McpElicitationAnswer | null> {
  const humanInLoop = call.context?.humanInLoop
  if (!humanInLoop || call.context?.interactive === false) return null
  const card: McpElicitationRequest = {
    // The call's id, as an `ask` uses: the card is cleared with the call and answered by its id.
    id: call.toolCallId,
    kind: 'mcp_elicitation',
    title: `${call.displayName} asks for input`,
    payload: {
      server: call.displayName,
      message: request.message,
      mode: request.mode,
      ...(request.requestedSchema ? { requestedSchema: request.requestedSchema } : {}),
      ...(request.url ? { url: request.url } : {}),
      ...(request.elicitationId ? { elicitationId: request.elicitationId } : {}),
    },
    createdAt: Date.now(),
    expiresAt: hitlDecisionDeadline(),
  }
  const signals = [signal, call.signal].filter((s): s is AbortSignal => Boolean(s))
  const resume = call.hold?.()
  try {
    const response = await humanInLoop.request<McpElicitationRequest, McpElicitationResponse>(
      card,
      signals.length > 0 ? AbortSignal.any(signals) : undefined,
    )
    const answer = response.payload.answers
    const action = answer?.action
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return null
    return { action, ...(answer.content ? { content: answer.content } : {}) }
  } catch (error) {
    // Esc on the card is Claude Code's cancel; a timeout or a stopped run asked nobody.
    if (errorName(error).startsWith('HumanInLoop')) return null
    throw error
  } finally {
    resume?.()
  }
}

/** Answer one `elicitation/create` from `client`. */
export async function answerElicitation(
  client: object,
  params: ElicitParams,
  signal?: AbortSignal,
  logger?: Logger,
): Promise<ElicitResult> {
  const calls = callsByClient.get(client)
  const call = calls?.[calls.length - 1]
  if (!call) return { action: 'cancel' }
  const request = hookRequest(call, params)
  const hooks = call.context?.mcpElicitationHooks

  // An answer from an Elicitation hook goes straight to the server; ElicitationResult is skipped.
  const fromHook = await hooks?.before(request)
  if (fromHook) return checked(request, fromHook, logger)

  const answer = (await askPerson(call, request, signal)) ?? { action: 'cancel' as const }
  const reviewed = (await hooks?.after(request, answer)) ?? answer
  return checked(request, reviewed, logger)
}

/** The Localix MCP client: offers elicitation and answers it through the calls it serves. */
export function createElicitingClient(
  info: { name: string; version: string },
  logger?: Logger,
): Client {
  const client = new Client(info, { capabilities: { elicitation: { form: {}, url: {} } } })
  client.setRequestHandler(ElicitRequestSchema, (request, extra) =>
    answerElicitation(client, request.params, extra.signal, logger),
  )
  return client
}

/** Upper bound the SDK accepts for a request timer; the call's own deadline governs instead. */
const SDK_TIMEOUT_CEILING_MS = 2_147_483_647

/**
 * A tool call's timeout that stops while the person answers an elicitation: a server waiting on
 * the person is not a slow server. Expiry aborts the call with the SDK's own timeout error.
 */
export function createCallDeadline(
  timeoutMs: number,
  outer: AbortSignal | undefined,
  timeoutError: () => Error,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let remaining = timeoutMs
  let startedAt = Date.now()
  let holds = 0
  const arm = () => {
    startedAt = Date.now()
    timer = setTimeout(() => controller.abort(timeoutError()), remaining)
    timer.unref?.()
  }
  arm()
  return {
    signal: outer ? AbortSignal.any([outer, controller.signal]) : controller.signal,
    sdkTimeoutMs: SDK_TIMEOUT_CEILING_MS,
    hold(): () => void {
      if (holds++ === 0 && timer) {
        clearTimeout(timer)
        timer = undefined
        remaining = Math.max(0, remaining - (Date.now() - startedAt))
      }
      let released = false
      return () => {
        if (released) return
        released = true
        if (--holds === 0 && !controller.signal.aborted) arm()
      }
    },
    clear() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
