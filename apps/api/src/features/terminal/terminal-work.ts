/**
 * A PTY that is not a bash job is still the session's work, and is recorded as such.
 *
 * Two paths open one: the preview's "start the server again" route, and the agent's interactive
 * `bash action:"open"`. Neither goes through the run's action registry, which is what records a
 * bash job — so without this the pane was invisible to every reader of the work registry: the
 * composer's work strip, the `# Background jobs` prompt section and the `jobs` tool. The agent,
 * blind to the terminal it had opened, opened another, and nothing ever told it to close either.
 *
 * The record is keyed by the PTY (`terminal:<id>`) because there is no action-registry entry to
 * key it by; readers that act on it (`jobs stop`, the strip's Stop) go through its `terminalId`.
 */
import type { WorkOwner } from '../work/contracts'
import type { WorkRegistry } from '../work/registry'

/** The conventional status of an interrupted process — what `TerminalSession.dispose` reports. */
const INTERRUPTED = 130

export interface RecordTerminalWork {
  owner: WorkOwner
  /** The participant whose run opened it; null for a pane the person started. */
  agentId: string | null
  label: string
  terminal: { id: string; onExit: (listener: (code: number) => void) => unknown }
}

export function recordTerminalWork(work: WorkRegistry, input: RecordTerminalWork): void {
  const toolCallId = `terminal:${input.terminal.id}`
  work.start({
    owner: input.owner,
    agentId: input.agentId,
    kind: 'job',
    label: input.label,
    toolCallId,
    messageId: null,
  })
  work.setTerminal(toolCallId, input.terminal.id)
  // A closed pane was stopped, not failed: `close` disposes it, which exits it with 130.
  input.terminal.onExit((code) =>
    work.end(toolCallId, {
      status: code === 0 ? 'succeeded' : code === INTERRUPTED ? 'cancelled' : 'failed',
      exitCode: code,
    }),
  )
}
