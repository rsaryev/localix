/**
 * Quick fixes from a finished command's output. Given a command's typed line, its
 * captured output, and its exit code (all from the OSC 133 marks — see
 * `terminalCommands.ts`), suggest a concrete next action: run a fix-up command or
 * open a link. These surface in the exit-code dot's action menu.
 *
 * Each matcher is a regex over the command line + output, gated on the exit
 * result, producing one or more actions. We cover the high-frequency dev/agent
 * flows (git upstream, git "did you mean", stuck port, GitHub PR link). A `command`
 * fix is PASTED onto the prompt for review, never auto-executed. Only a `link` fix
 * acts immediately (opens a URL).
 */

export interface CommandContext {
  /** The command the user typed (prompt stripped). */
  command: string
  /** The command's stdout+stderr, plain text. */
  output: string
  /** Exit code, or null when unknown. 0 = success. */
  exitCode: number | null
}

export type TerminalQuickFix =
  | { kind: 'command'; label: string; command: string }
  | { kind: 'link'; label: string; url: string }

type Matcher = (ctx: CommandContext) => TerminalQuickFix[]

const isError = (code: number | null) => code !== null && code !== 0

/** `git push` with no upstream → offer the exact `--set-upstream` line git prints. */
const gitPushSetUpstream: Matcher = ({ command, output, exitCode }) => {
  if (!isError(exitCode) || !/\bgit\s+push\b/.test(command)) return []
  const m = output.match(/git push --set-upstream origin (?<branch>[^\s]+)/)
  const branch = m?.groups?.branch
  if (!branch) return []
  return [
    {
      kind: 'command',
      label: `Set upstream to origin/${branch}`,
      command: `git push --set-upstream origin ${branch}`,
    },
  ]
}

/** `git <typo>` → offer each of git's "most similar command" suggestions. */
const gitSimilar: Matcher = ({ command, output, exitCode }) => {
  if (!isError(exitCode) || !/\bgit\b/.test(command)) return []
  const anchor = output.match(/most similar commands? (?:is|are)/i)
  if (!anchor) return []
  // Suggestions are the indented, one-per-line tokens following the anchor line.
  const after = output.slice(anchor.index! + anchor[0].length)
  const seen = new Set<string>()
  const fixes: TerminalQuickFix[] = []
  for (const line of after.split('\n')) {
    const sub = line.trim()
    // Stop at the first blank line after suggestions; a suggestion is a bare word.
    if (!sub) {
      if (fixes.length) break
      else continue
    }
    if (!/^[a-z][a-z-]*$/.test(sub) || seen.has(sub)) continue
    seen.add(sub)
    // Replace the (mistyped) git subcommand with the suggestion.
    const fixed = command.replace(/(\bgit\s+)[^\s]+/, `$1${sub}`)
    fixes.push({ kind: 'command', label: `git ${sub}`, command: fixed })
  }
  return fixes
}

/** Port already in use → offer to free it (kill the listening process). */
const freePort: Matcher = ({ output, exitCode }) => {
  if (!isError(exitCode)) return []
  const m = output.match(
    /(?:address already in use (?:0\.0\.0\.0|127\.0\.0\.1|localhost|\[?::\]?):|Unable to bind [^ ]*:|can't listen on port |listen EADDRINUSE[^\d]*:?)(?<port>\d{2,5})/i,
  )
  const port = m?.groups?.port
  if (!port) return []
  return [
    {
      kind: 'command',
      label: `Free port ${port} (kill listener)`,
      command: `lsof -ti tcp:${port} | xargs kill -9`,
    },
  ]
}

/** `git push` prints a "Create a pull request … visiting: <url>" link → open it. */
const gitCreatePr: Matcher = ({ output }) => {
  const m = output.match(/(?<url>https:\/\/[^\s]+\/pull\/new\/[^\s]+)/)
  const url = m?.groups?.url?.replace(/[).,]+$/, '')
  if (!url) return []
  return [{ kind: 'link', label: 'Create pull request', url }]
}

const MATCHERS: Matcher[] = [gitPushSetUpstream, gitSimilar, freePort, gitCreatePr]

/**
 * Compute the quick fixes offered for a finished command. De-duplicates by
 * label so two matchers never suggest the same action twice.
 */
export function computeQuickFixes(ctx: CommandContext): TerminalQuickFix[] {
  if (!ctx.command && !ctx.output) return []
  const out: TerminalQuickFix[] = []
  const seen = new Set<string>()
  for (const matcher of MATCHERS) {
    for (const fix of matcher(ctx)) {
      if (seen.has(fix.label)) continue
      seen.add(fix.label)
      out.push(fix)
    }
  }
  return out
}
