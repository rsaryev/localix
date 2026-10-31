/**
 * Exit-code-1 "no findings" convention: for a small family of search/compare
 * commands, exit 1 is a STATUS, not a failure — grep/rg exit 1 for "no matches",
 * diff/cmp for "files differ", `git diff --exit-code` for "there are changes".
 * Flagging those `isError` has teeth: the loop's consecutive-tool-errors guard
 * counts them, so three greps that legitimately found nothing read as a failing
 * agent. This classifies ONLY that convention — deliberately narrow:
 *
 * - exit code exactly 1 (grep's exit 2 = real error, diff's 2 = trouble);
 * - a single simple command — any pipe/compound/substitution makes the exit
 *   code's origin ambiguous, so those keep the strict reading;
 * - a command whose leading word is in the known family. No structural
 *   heuristic ("has stdout, empty stderr") — tsc and test runners print their
 *   failures to stdout with exit 1, and those MUST stay errors.
 */

import { isTerminationSignalExit } from '../../../../lib/process-exit'

const NO_FINDINGS_COMMANDS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'zgrep', 'diff', 'cmp'])

/** Compound/pipeline syntax — exit code no longer attributable to the leading command. */
const COMPOUND_RE = /[|;&`]|\$\(|&&|\|\|/

export function isNoFindingsExit(command: string, exitCode: number): boolean {
  if (exitCode !== 1) return false
  const trimmed = command.trim()
  if (COMPOUND_RE.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  // Skip leading VAR=value assignments (e.g. `LC_ALL=C grep …`).
  let i = 0
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++
  const head = words[i]?.replace(/^.*\//, '') ?? ''
  if (NO_FINDINGS_COMMANDS.has(head)) return true
  // `git diff` / `git grep`: exit 1 only ever means findings/differences
  // (`--exit-code` mode), never a git failure — those exit 128/129.
  return head === 'git' && (words[i + 1] === 'diff' || words[i + 1] === 'grep')
}

/** The model-facing status note for a soft exit-1 — names the convention so the model doesn't re-run "the failure". */
export const NO_FINDINGS_NOTE =
  '[exit 1 — grep/diff status convention (no matches, or differences present), not a failure]'

/**
 * A non-zero exit that is a real failure. A stop signal (SIGTERM from a killed dev server,
 * ^C) means the process was TOLD to stop, and a grep/diff-family exit 1 is a findings status:
 * neither fails the call nor halts a multi-command run.
 */
export function isFailedExit(command: string, exitCode: number): boolean {
  return (
    exitCode !== 0 && !isTerminationSignalExit(exitCode) && !isNoFindingsExit(command, exitCode)
  )
}
