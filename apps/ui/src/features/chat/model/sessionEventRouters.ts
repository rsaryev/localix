import { publishFsChange } from '@/shared/lib/fsChangeBus'
import type { AgentStreamEvent } from '@/shared/api/contracts'
import { useLiveTerminalsStore } from '@/features/terminal/model/liveTerminals'
import { applyTerminalState, forgetTerminalState } from '@/features/terminal/model/terminalStates'
import { finishTerminalTabs } from '@/features/terminal/model/deadTerminalTabs'
import { useChatStore } from './store'
import { backendClient } from '@/shared/api/client'
import { openPolicy } from '@/shared/lib/workspaceOf'

import { forwardableSessionPhase } from '@localixai/plugin-sdk/ui'
import { pluginCommandBus } from '@localixai/plugin-sdk/ui/commands'
import { pluginSessionEventBus } from './pluginSessionEventBus'

/**
 * Typed plugin→UI command (`session.emitCommand` on the backend): dispatch to the
 * per-plugin sink registry, never through the store. The frame is
 * replayable and non-coalescing; the bus dedups replays by `commandId`. The router
 * only computes the focus-policy input — whether the command came from the ACTIVE
 * session — so plugin sinks can honor "background sessions must not steal focus"
 * without importing the chat store.
 */
export function routePluginCommand(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'plugin.command' }>,
): void {
  pluginCommandBus.publish(
    {
      sessionId,
      plugin: parsed.plugin,
      channel: parsed.channel,
      payload: parsed.payload,
      commandId: parsed.commandId,
      seq: parsed.seq,
    },
    openPolicy(useChatStore.getState().activeSessionId, sessionId) === 'focus',
    // Reply seam for AWAITED commands (`emitCommandWithReply`): the sink's answer
    // rides the `plugin-command-result` WS RPC back to settle the server-side
    // pending promise, correlated by this frame's commandId. Fire-and-forget —
    // a lost socket just lets the server time out to its honest noReply.
    (payload) => void backendClient.pluginCommandResult(parsed.commandId, payload).catch(() => {}),
  )
}

/**
 * Forward a SAFE session-lifecycle signal to bridged plugin views. The SDK
 * allow-list ({@link forwardableSessionPhase}) decides which internal event
 * types may cross and under which phase — only run start/completed/failed, and
 * only their phase + session id (never tool payloads, error text or secrets).
 * Non-forwardable types are a no-op. Additive: it never consumes the event, so
 * the normal store/toast handling still runs.
 */
export function routePluginSessionEvent(sessionId: string, type: string): void {
  const phase = forwardableSessionPhase(type)
  if (phase) pluginSessionEventBus.publish({ sessionId, phase })
}

/**
 * On-disk file change under a session's workspace: relay to the file-tree sidebar via
 * the bus (not the store — the tree owns its own lazy-loaded state). Transient and
 * idempotent: the sidebar reloads exactly the changed directories it has open.
 */
export function routeFsChanged(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  publishFsChange({
    sessionId,
    paths: parsed.paths,
    ...(parsed.changedPaths === undefined ? {} : { changedPaths: parsed.changedPaths }),
    ...(parsed.live === undefined ? {} : { live: parsed.live }),
  })
}

/**
 * The agent spawned a PTY (`bash action:"open"` interactive terminal or a `bash background:true`
 * job pane): seed the live-PTY registry so transcript cards render it alive immediately (no
 * "Terminal closed" flash before the next registry read). It opens no tab: the pane waits in the
 * chat's work strip and its command card, and the agent shows it with `open` when it should be seen.
 */
export function routeTerminalOpened(
  parsed: Extract<AgentStreamEvent, { type: 'terminal.opened' }>,
): void {
  useLiveTerminalsStore.getState().noteOpened(parsed.terminalId)
}

/**
 * A pushed `terminal.state` frame (a full-screen takeover, a served URL): record it for the tab
 * and the composer. A takeover opens nothing — not even a tab-less pane's.
 */
export function routeTerminalState(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'terminal.state' }>,
): void {
  applyTerminalState(sessionId, parsed)
}

/** A terminal exit is push-driven too: retire transcript actions immediately.
 *  The next registry poll remains the reconnect source of truth, but is no
 *  longer on the correctness path for disabling a dead PTY. */
export function routeTerminalFinished(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'terminal.finished' }>,
): void {
  finishTerminalTabs(parsed.terminalId, {
    exitCode: parsed.exitCode,
    interactive: parsed.interactive,
    command: parsed.command,
    cwd: parsed.cwd,
  })
  // Its "Open preview" and takeover state die with it, not on the next backstop poll.
  forgetTerminalState(sessionId, parsed.terminalId)
}
