/**
 * Command shapes that earn the model a <system-reminder> on the bash result: a file READ
 * through the shell (its dump stays in context forever, a `read` is elidable) and a file
 * WRITTEN through the shell (nothing tracks it; the mtime guard refuses the next write/edit).
 * Detection, the hint text, and the per-call `mutated` verdict bash reports from them.
 */
import type { AgentToolResult } from '@localixai/agent/agents'
import { isReadOnlyCommand } from './bash-readonly-classify'
/**
 * A bash command that DUMPS A FILE through the shell instead of using the `read` tool.
 *
 * The distinction is not stylistic. A `read` result is a recoverable observation: the
 * context machinery elides it to a pointer and the model re-reads from disk if it ever
 * needs the bytes back. Shell output is NON-recoverable — it can only be bounded, never
 * dropped — so a `cat` of a 1000-line file taxes every subsequent request of the
 * session at full size. Historical analysis counted 165 of these over 763 sessions.
 *
 * The pattern (shared with that script) deliberately stops at pipes and command
 * separators so `ls | head -20` or `find … | head` — `head` over COMMAND output, not a
 * file — is not caught just because a `.ext` appears later in the compound command
 * (a verified false positive). `(?!>)` excludes `cat > file <<EOF`, which
 * CREATES a file rather than dumping one.
 */
const BASH_FILE_DUMP = /(^|[\s;&|(])(cat|nl|sed -n|head|tail)\s+(?!>)[^|>;&]*\.\w/

export function isFileDumpCommand(command: string): boolean {
  return BASH_FILE_DUMP.test(command)
}

/**
 * A file WRITTEN through the shell: redirection into a named file, `tee`, in-place `sed`.
 * Not `>` to /dev/null or a pipe, and not `>>` into a log (appends are how a run logs).
 */
const BASH_SHELL_WRITE =
  /(^|[\s;&|(])(cat|echo|printf)\b[^|;&]*?(?<![>0-9])>(?!>)\s*(?!\/dev\/null)[^\s|;&>]+|(^|[\s;&|(])tee\s+(?!-a\b)|(^|[\s;&|(])sed\s+-i\b/

export function isShellFileWriteCommand(command: string): boolean {
  return BASH_SHELL_WRITE.test(command)
}

/**
 * `bash` is statically `mutates: true` — it can `rm -rf`. But most shell calls in a
 * research streak (`rg`, `git diff`, `ls`) change nothing, and a mutating call resets
 * the loop's exploration-guard streak, so a model that investigates exclusively
 * through the shell was never braked. The tool classifies its own call and reports the
 * truth per invocation; the agnostic core never learns any command names.
 *
 * Foreground/batch only: a BACKGROUND job outlives the call (a dev server, a watcher),
 * so it is treated as mutating regardless of how its command line reads.
 */
export async function withMutationFlag<TDetails>(
  commands: readonly string[],
  result: Promise<AgentToolResult<TDetails>>,
  fileTools?: { read: boolean; write: boolean },
): Promise<AgentToolResult<TDetails>> {
  const awaited = await withFileDumpHint(commands, await result, fileTools)
  if (awaited.mutated !== undefined) return awaited
  return commands.every((c) => isReadOnlyCommand(c)) ? { ...awaited, mutated: false } : awaited
}

/**
 * The model just read a file through the shell. Say so, HERE, where the behaviour is
 * happening — a system-prompt line about preferring `read` is read once at turn 0 and
 * forgotten forty turns deep (same rationale as the exploration guard's nudge).
 *
 * Delivered the way `<lsp_diagnostics>` is: appended to the tool result the model is
 * already reading. Never on an error (the failure detail is what matters there) and
 * never on empty output.
 */
export const FILE_DUMP_HINT = [
  '<system-reminder>',
  'That command read a file through the shell. Shell output cannot be recovered, so it',
  'stays in your context at full size for the rest of the session; a `read` result is',
  'cheaply elided and can be fetched back on demand. Use `read` (with startLine/endLine)',
  'to inspect file contents, and bash to RUN things. Do not re-read this file to correct',
  'the mistake — you already have its contents above.',
  '</system-reminder>',
].join('\n')

/**
 * The model just WROTE a file through the shell (`cat > f <<EOF`, `sed -i`, `tee`). Nothing
 * tracks that: the mtime guard will refuse the model's next `write`/`edit` on the file as
 * "changed on disk" until it reads it again, and no diagnostics ran. Seen live: one
 * `sed -i` on a scratch script cost a refused write, a refused read and two recovery turns.
 */
export const FILE_WRITE_HINT = [
  '<system-reminder>',
  'That command wrote a file through the shell. Nothing tracks a shell write: your next',
  '`write`/`edit` on that file will be refused as "changed on disk" until you `read` it',
  'again, and no diagnostics ran. Create and change files with `write`/`edit`/`apply_patch`;',
  'use bash to RUN things.',
  '</system-reminder>',
].join('\n')

async function withFileDumpHint<TDetails>(
  commands: readonly string[],
  result: AgentToolResult<TDetails>,
  fileTools: { read: boolean; write: boolean } = { read: true, write: true },
): Promise<AgentToolResult<TDetails>> {
  if (result.isError || typeof result.content !== 'string') return result
  let content = result.content
  if (
    fileTools.read &&
    content.trim() !== '' &&
    !content.includes(FILE_DUMP_HINT) &&
    commands.some(isFileDumpCommand)
  )
    content = `${content}\n\n${FILE_DUMP_HINT}`
  if (
    fileTools.write &&
    !content.includes(FILE_WRITE_HINT) &&
    commands.some(isShellFileWriteCommand)
  )
    content = `${content.trim() ? `${content}\n\n` : ''}${FILE_WRITE_HINT}`
  return content === result.content ? result : { ...result, content }
}
