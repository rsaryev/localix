/**
 * A MINI APP STARTS A TURN IN A SESSION, AND THE AGENT ANSWERS THROUGH THE MINI APP'S TOOLS.
 *
 * The seam this replaces handed a mini app `wakeSession({ content })` and answered `void`, and
 * every gap in it broke the first mini app that leaned on it — a game waiting for the agent's move:
 *   - nothing came back, so the game could not tell a wake that landed from one that went nowhere,
 *     and waited for a move that was never coming;
 *   - the woken turn found the game's tools deferred behind `ToolSearch`, and spent its first
 *     call fetching the schema of the tool it had been woken to use;
 *   - the turn read as "via External", a webhook, and the model got the mini app's words with
 *     nothing saying the person had not typed them;
 *   - a double click woke the session twice.
 *
 * One request, answered in three steps that each guard the next: CHECK the request (a message, a
 * well-formed key, and only tools THIS mini app registered — the host knows them from the load) →
 * FRAME it (where it came from and which tools answer it) → DELIVER it through the one wake
 * delivery, which activates the tools in the same admission. The shape is an idempotency key, an
 * outcome instead of a throw, and the host stamping the source, plus the tools the turn answers
 * with.
 */
import type { MiniAppWakeOutcome, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import type { WakeRequest } from '../chat/contracts'
import type { WakeOutcome } from '../triggers/delivery'

/** A wake is a notice, not a document: past this the agent is being handed a report to read. */
export const MINI_APP_WAKE_MESSAGE_MAX = 2_000
/** More than this is a suite rather than an answer, and every tool named stays on the wire. */
export const MINI_APP_WAKE_TOOLS_MAX = 6
const KEY_SHAPE = /^[\w.:-]{1,120}$/

type Checked =
  | { ok: true; message: string; tools: string[]; key?: string }
  | { ok: false; reason: string }

/** The request against the contract in `MiniAppWakeRequest`, and the tools this mini app owns. */
export function checkMiniAppWake(
  request: MiniAppWakeRequest,
  ownedTools: readonly string[],
): Checked {
  if (!request.userId?.trim() || !request.sessionId?.trim())
    return { ok: false, reason: 'a wake needs the userId and sessionId of the session to wake' }
  const message = request.message?.trim() ?? ''
  if (!message) return { ok: false, reason: 'the message is empty' }
  if (message.length > MINI_APP_WAKE_MESSAGE_MAX)
    return {
      ok: false,
      reason: `the message is ${message.length} characters; a wake carries at most ${MINI_APP_WAKE_MESSAGE_MAX}`,
    }
  const tools = [...new Set(request.tools ?? [])]
  if (tools.length > MINI_APP_WAKE_TOOLS_MAX)
    return { ok: false, reason: `a wake names at most ${MINI_APP_WAKE_TOOLS_MAX} tools` }
  const foreign = tools.filter((tool) => !ownedTools.includes(tool))
  if (foreign.length > 0)
    return {
      ok: false,
      reason: `${foreign.join(', ')} ${foreign.length === 1 ? 'is not a tool' : 'are not tools'} of this mini app (${ownedTools.join(', ') || 'it registers none'})`,
    }
  if (request.key !== undefined && !KEY_SHAPE.test(request.key))
    return { ok: false, reason: 'the key allows letters, digits and .:_- up to 120 characters' }
  return { ok: true, message, tools, ...(request.key !== undefined ? { key: request.key } : {}) }
}

/**
 * The words the woken turn reads. The bracket line is the provenance a model cannot get from the
 * row's origin tag — it never sees that — so it says who sent it, that the person did not type it,
 * and what answers it. The same shape as the webhook's `wrapInboundMessage`.
 */
export function frameMiniAppWake(app: string, message: string, tools: readonly string[]): string {
  const answer = tools.length > 0 ? ` Answer with its tools: ${tools.join(', ')}.` : ''
  return `[From the "${app}" mini app — sent by the app, not typed by the user.${answer}]\n\n${message}`
}

export interface MiniAppWakesDeps {
  /** The one wake delivery. Read per wake: it is bound after the mini app hosts are built. */
  deliver: (request: WakeRequest) => Promise<WakeOutcome>
  logger: { warn: (entry: Record<string, unknown>) => void }
}

/**
 * The `wake` host service, one per mini app, checked against what each mini app registered on the
 * latest load — replaced whole on every load, so a rebuilt mini app's renamed tool is refused at
 * once.
 */
export function createMiniAppWakes(deps: MiniAppWakesDeps) {
  let ownedTools = new Map<string, readonly string[]>()

  return {
    /** Record what a load registered. A mini app loaded in several scopes owns the union. */
    recordTools(loaded: readonly { name: string; toolNames: readonly string[] }[]): void {
      const next = new Map<string, string[]>()
      for (const miniApp of loaded)
        next.set(miniApp.name, [
          ...new Set([...(next.get(miniApp.name) ?? []), ...miniApp.toolNames]),
        ])
      ownedTools = next
    },

    forMiniApp(miniAppName: string) {
      return async (request: MiniAppWakeRequest): Promise<MiniAppWakeOutcome> => {
        const checked = checkMiniAppWake(request, ownedTools.get(miniAppName) ?? [])
        if (!checked.ok) return { status: 'refused', reason: checked.reason }
        const outcome = await deps.deliver({
          userId: request.userId,
          sessionId: request.sessionId,
          content: frameMiniAppWake(miniAppName, checked.message, checked.tools),
          source: 'mini-app',
          miniApp: miniAppName,
          ...(checked.key ? { deliveryKey: `mini-app:${miniAppName}:${checked.key}` } : {}),
        })
        if (outcome.status !== 'failed') return outcome
        // The one outcome worth an operator's attention; the mini app is told the same reason.
        deps.logger.warn({
          event: 'mini_app_wake.failed',
          miniApp: miniAppName,
          sessionId: request.sessionId,
          err: outcome.detail,
        })
        return { status: 'failed', reason: outcome.detail }
      }
    },
  }
}
