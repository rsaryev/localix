/**
 * Wrap a PTY-spawning capability so every successful spawn announces itself on
 * the stream as `terminal.opened`. The UI adopts + reveals the terminal tab and
 * seeds its live-PTY registry IMMEDIATELY — push, not the background-jobs poll
 * (up to 15s away, and the poll's alt-screen auto-reveal only fires for apps
 * that actually enter the alternate screen, which e.g. `claude` never does).
 * Used by both agent PTY paths: `bash background:true` job panes
 * (spawnTerminalJob) and `bash action:"open"` interactive terminals.
 */
export function announcePtyOpen<I extends { command: string }, R extends { terminalId: string }>(
  open: (input: I) => Promise<R>,
  publish: (event: {
    type: 'terminal.opened'
    sessionId: string
    terminalId: string
    command?: string
  }) => void,
  sessionId: string,
): (input: I) => Promise<R> {
  return async (input) => {
    const result = await open(input)
    publish({
      type: 'terminal.opened',
      sessionId,
      terminalId: result.terminalId,
      command: input.command,
    })
    return result
  }
}
