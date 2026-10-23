/**
 * Read-only access to the chat's terminals: what a plugin that watches external agents reads. The
 * host checks ownership on every call, the same boundary the interactive `terminal` tool uses.
 */

/** The visible screen of a terminal, already VT-emulated by the host. */
export interface MiniAppScreenSnapshot {
  /** Visible rows joined with '\n', trailing blanks trimmed. */
  readonly text: string
  readonly cursor: { readonly row: number; readonly col: number }
  readonly cols: number
  readonly rows: number
}

export interface TerminalRead {
  /** Current visible screen, or null when the terminal is not this session's or no longer exists. */
  screen(input: {
    sessionId: string | null
    terminalId: string
  }): Promise<MiniAppScreenSnapshot | null>
  /**
   * The retained final screen of a terminal that has EXITED. Separate from `screen` so a finished
   * process is never mistaken for a live one.
   */
  finalScreen(input: {
    sessionId: string | null
    terminalId: string
  }): Promise<MiniAppScreenSnapshot | null>
  /** Live terminals bound to this chat session. */
  list(input: { sessionId: string | null }): { terminalId: string; command?: string }[]
  /**
   * Subscribe to a terminal's output and exit, so a reader re-reads `screen` when it can have
   * changed instead of on a timer. The same ownership check as `screen`: null when the terminal is
   * not this session's or no longer exists. Optional because an older host does not offer it.
   */
  watch?(
    input: { sessionId: string | null; terminalId: string },
    onEvent: (event: 'output' | 'exit') => void,
  ): (() => void) | null
}
