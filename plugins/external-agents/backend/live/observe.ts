/**
 * Turn the host's tool-call hooks into live delegation state.
 *
 * Wiring: `onPostToolCall` fires for EVERY tool the model runs, with the tool's full input and
 * result. For the built-in `bash` tool's interactive terminal actions the result carries
 * `details = { action, terminalId, command, screen }`, where `screen` is the rendered
 * `ScreenSnapshot` the host already produced for the model. We read it and classify it.
 *
 * Why an observer and not a poller: the plugin has no way to read a terminal on its own (no
 * terminal surface exists in the plugin SDK), and polling the loopback terminal WebSocket would
 * mean re-implementing a VT emulator to turn raw bytes back into a screen. Observing costs nothing
 * and reuses the host's own rendering.
 *
 * Hooks are capped at 5s each by the host and a throw is swallowed, so everything here is
 * synchronous, allocation-light, and total.
 */

import type { LiveStore } from './store'
import { detectLaunchCwd, detectLaunchKind } from './launch-kinds'

/**
 * How each of the bash tool's interactive actions bears on observation.
 *
 * This is a JUDGEMENT about the host's `INTERACTIVE_ACTIONS`, not a mirror of it: what matters here
 * is whether an action's result carries a terminal to adopt, a screen to read, or a close to record.
 * `list` is deliberately none of those — it enumerates panes and names no single terminal, so its
 * result is not an observation.
 *
 * Exported because the partition has to stay TOTAL over the host's catalog. A new interactive action
 * that renders a screen would otherwise be ignored in silence, and the live half would simply see
 * less than it used to with nothing failing; `observe.test.ts` asserts the totality against the
 * host's own list.
 */
export const OPEN_ACTIONS = new Set(['open'])
export const SCREEN_ACTIONS = new Set(['screen', 'keys', 'type', 'wait'])
export const CLOSE_ACTIONS = new Set(['close'])
/** Interactive actions that are deliberately not observations — see above. */
export const IGNORED_ACTIONS = new Set(['list'])

interface TerminalDetails {
  action?: unknown
  terminalId?: unknown
  command?: unknown
  screen?: unknown
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The host's `ScreenSnapshot` is `{cols, rows, cursor, text}`, but a defensive read also accepts a
 * bare string, because a details shape we mis-guess must degrade to "no screen observed" rather
 * than throw inside a hook.
 */
function screenTextOf(screen: unknown): string | undefined {
  if (typeof screen === 'string') return screen
  if (screen && typeof screen === 'object') {
    const text = (screen as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return undefined
}

export interface ObserveDeps {
  readonly live: LiveStore
  /** Called when a new agent delegation is detected, so its transcript can be correlated. */
  readonly onOpened: (terminalId: string) => void
  readonly log: (message: string) => void
}

export function observeToolCall(
  deps: ObserveDeps,
  event: {
    toolName: string
    input: unknown
    result: { content: string; details?: unknown }
    sessionId: string
  },
): void {
  if (event.toolName !== 'bash') return
  const details = (event.result.details ?? {}) as TerminalDetails
  const action = str(details.action)
  const terminalId = str(details.terminalId)
  if (!action || !terminalId) return

  if (CLOSE_ACTIONS.has(action)) {
    deps.live.close(terminalId)
    return
  }

  const known = deps.live.get(terminalId)

  if (OPEN_ACTIONS.has(action) && !known) {
    const command = str(details.command)
    const provider = detectLaunchKind(command)
    // A terminal that is not running a recognized agent is not a delegation. Tracking every shell
    // the model opens would fill the roster with noise and classify `ls` output against an agent
    // manifest.
    if (!provider) return
    deps.live.open({
      terminalId,
      localixSessionId: event.sessionId,
      provider,
      launchCommand: command,
      // Read once, at open: the launch line is the only moment these declarations exist, and
      // re-deriving them from a later screen is impossible.
      cwd: detectLaunchCwd(command),
    })
    deps.onOpened(terminalId)
  }

  if (!deps.live.get(terminalId)) return

  if (OPEN_ACTIONS.has(action) || SCREEN_ACTIONS.has(action)) {
    // `open` returns the initial screen too, so it is a screen observation as well as a launch.
    const text = screenTextOf(details.screen) ?? event.result.content
    if (text) deps.live.observeScreen(terminalId, text)
  }
}

// A delegation's own REPORT used to arrive here, parsed out of the user message a webhook protocol
// produced, and it outranked every observation. Sender and receiver are both gone: the mechanism
// required the foreign agent to cooperate, so an agent that ignored the injected instruction
// produced silence indistinguishable from work. State is observed now — screen, then transcript.
