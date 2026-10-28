/* oxlint-disable no-control-regex -- this module parses/strips terminal ANSI escape + C0 control sequences; matching control chars in these regexes is the whole job */
/**
 * Pure builder for the `@terminal:<id>` context-ref expansion — a COMPACT,
 * token-economical digest of a live PTY terminal: cwd, the last few commands
 * with exit codes (reconstructed from the OSC 133 shell-integration marks the
 * server injects into interactive panes), and a bounded ANSI-stripped tail of
 * recent output. Deliberately small: the header points the agent at the
 * `bash` interactive actions to read the full screen or interact.
 *
 * Kept free of PTY / service imports so the mark parsing + trimming rules stay
 * unit-testable; the caller (bootstrap) feeds it a session's info + scrollback.
 */

/** Max reconstructed commands shown in the digest. */
export const DIGEST_MAX_COMMANDS = 5
/** Max chars kept per reconstructed command line. */
export const DIGEST_COMMAND_CHARS = 200
/** Max lines kept in the output tail. */
export const DIGEST_TAIL_LINES = 40
/** Max chars kept in the output tail. */
export const DIGEST_TAIL_CHARS = 3000

export interface TerminalDigestInput {
  /** Full backend terminal id (UUID). */
  id: string
  cwd: string
  /** One-shot command the pane runs, when agent/preview-launched (vs a shell). */
  command?: string
  /** True while a full-screen TUI holds the alternate screen buffer. */
  altScreen: boolean
  /** Epoch ms of the most recent PTY output. */
  lastOutputAt: number
  /** Raw retained scrollback (ANSI + OSC marks included). */
  scrollback: string
  /** Rendered viewport, including TUIs that redraw the normal buffer instead of the alternate. */
  screen?: string
  /** Injectable clock for tests. */
  now?: number
}

/** One reconstructed command span from the OSC 133 marks. */
export interface ScrollbackCommand {
  command: string
  /** Undefined while the command is still running (C seen, no D yet). */
  exitCode?: number
}

// OSC 133 semantic-prompt marks (FinalTerm grammar), BEL- or ST-terminated:
//   A prompt start · B input start · C pre-exec · D;N finished with exit code N.
const OSC_133_RE = /\x1b\]133;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g

// Strip order matters: OSC first (may contain digits/semicolons), then CSI, then
// bare two-char escapes, then stray control chars (keep \n and \t).
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ESC2_RE = /\x1b[@-Z\\-_]|\x1b[()][A-Za-z0-9]/g
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** Plain text of a raw VT chunk: escapes removed, bare CR treated as line overwrite. */
export function stripAnsi(raw: string): string {
  const text = raw
    .replace(/\r\n/g, '\n') // CRLF is a plain newline, not an overwrite
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC2_RE, '')
    .replace(CTRL_RE, '')
  // A carriage return overwrites the line (progress bars, spinners): keep only
  // what follows the last \r on each line so the tail shows the final state.
  return text
    .split('\n')
    .map((line) => {
      const cr = line.lastIndexOf('\r')
      return cr === -1 ? line : line.slice(cr + 1)
    })
    .join('\n')
}

/**
 * Reconstructs the command history from OSC 133 marks: the text between an
 * input-start (B) and the next pre-exec (C) is the echoed command line; the
 * following D;N carries its exit code. A trailing C without D = still running.
 */
export function parseScrollbackCommands(scrollback: string): ScrollbackCommand[] {
  const out: ScrollbackCommand[] = []
  let inputStart = -1
  let pending: ScrollbackCommand | null = null
  for (const match of scrollback.matchAll(OSC_133_RE)) {
    const mark = match[1]
    if (mark === 'B') {
      inputStart = match.index + match[0].length
    } else if (mark === 'C') {
      if (inputStart !== -1) {
        const echoed = stripAnsi(scrollback.slice(inputStart, match.index))
          .replace(/\s+/g, ' ')
          .trim()
        pending = echoed ? { command: echoed.slice(0, DIGEST_COMMAND_CHARS) } : null
        inputStart = -1
      }
    } else if (mark === 'D') {
      if (pending) {
        const code = Number(match[2])
        pending.exitCode = Number.isFinite(code) ? code : undefined
        out.push(pending)
        pending = null
      }
      inputStart = -1
    }
  }
  if (pending) out.push(pending) // still running (no D yet)
  return out
}

/** Bounded, ANSI-stripped tail of the scrollback (blank runs collapsed). */
export function scrollbackTail(scrollback: string): string {
  const lines = stripAnsi(scrollback)
    .split('\n')
    .map((l) => l.trimEnd())
  // Collapse runs of blank lines so the bounded tail carries actual content.
  const compact: string[] = []
  for (const line of lines) {
    if (line === '' && compact[compact.length - 1] === '') continue
    compact.push(line)
  }
  while (compact[0] === '') compact.shift()
  while (compact[compact.length - 1] === '') compact.pop()
  let tail = compact.slice(-DIGEST_TAIL_LINES).join('\n')
  if (tail.length > DIGEST_TAIL_CHARS) tail = `…${tail.slice(-DIGEST_TAIL_CHARS)}`
  return tail
}

const agoLabel = (ms: number): string => {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

/**
 * Renders the digest markdown block: a header line, the recent commands with
 * exit codes (interactive shells with OSC 133 integration only), and the output
 * tail, closed by a pointer to `bash` interactive actions for deeper reads.
 */
export function buildTerminalDigest(input: TerminalDigestInput): string {
  const now = input.now ?? Date.now()
  const lines: string[] = []
  const what = input.command ? `running \`${input.command}\`` : 'interactive shell'
  lines.push(`Terminal ${input.id.slice(0, 8)} — ${what} in ${input.cwd}`)
  const state = input.altScreen ? 'full-screen app on screen' : 'live'
  lines.push(`Status: ${state} · last output ${agoLabel(Math.max(0, now - input.lastOutputAt))}`)

  const commands = input.altScreen
    ? []
    : parseScrollbackCommands(input.scrollback).slice(-DIGEST_MAX_COMMANDS)
  if (commands.length > 0) {
    lines.push('')
    lines.push(`Recent commands (last ${commands.length}):`)
    for (const c of commands) {
      const status = c.exitCode === undefined ? 'running' : `exit ${c.exitCode}`
      lines.push(`[${status}] ${c.command}`)
    }
  }

  const rendered = input.screen !== undefined
  const clipped = (input.screen?.length ?? 0) > DIGEST_TAIL_CHARS
  const viewport = clipped
    ? `${input.screen!.slice(0, DIGEST_TAIL_CHARS / 2)}\n[… viewport clipped …]\n${input.screen!.slice(-DIGEST_TAIL_CHARS / 2)}`
    : (input.screen ?? '')
  const tail = rendered ? viewport : input.altScreen ? '' : scrollbackTail(input.scrollback)
  if (tail) {
    lines.push('')
    lines.push(
      rendered
        ? `Current rendered screen${clipped ? ' (clipped; use action="screen" for the full viewport)' : ''}:`
        : `Output tail (bounded, last ${DIGEST_TAIL_LINES} lines max):`,
    )
    lines.push(tail)
  } else {
    lines.push('')
    lines.push(
      rendered || input.altScreen
        ? '(Rendered screen unavailable or blank; use action="screen".)'
        : '(No output yet.)',
    )
  }

  lines.push('')
  lines.push(
    `Use \`Bash\` with terminal_id "${input.id}" and action="screen" to inspect, action="type" with text and keys:["Enter"] to submit, or action="keys" for navigation. Input actions return a fresh screen; add wait_for to await expected text in the same call.`,
  )
  return lines.join('\n')
}
