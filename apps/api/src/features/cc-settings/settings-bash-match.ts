import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import { matchBashSpecifier } from './permission-value-match'

/**
 * A `Bash(…)` rule of a Claude Code settings file against a command line, as Claude Code matches
 * it (permissions.md, "Compound commands", "Wrappers"):
 *
 *   - the line is split at `&&`, `||`, `;`, `|`, `&` and newlines, and each subcommand is matched
 *     on its own — an allow rule must cover every one, a deny or ask rule any one, including
 *     commands inside a substitution or a subshell;
 *   - `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob` and a bare
 *     `xargs` are stripped first, so `Bash(npm test *)` matches `timeout 30 npm test`;
 *   - a deny or ask rule matches past any leading `VAR=value`; an allow rule only past the
 *     assignment of a variable known to be harmless.
 */

const WRAPPERS_WITH_ARGS: Record<string, (words: string[]) => number> = {
  // `timeout [-s SIG] [-k D] DURATION cmd`
  timeout: (w) => {
    let i = 1
    while (w[i]?.startsWith('-')) i += /^-(s|k)$|^--(signal|kill-after)$/.test(w[i]!) ? 2 : 1
    return i + 1
  },
  nice: (w) => (w[1] === '-n' ? 3 : w[1]?.startsWith('-') ? 2 : 1),
  stdbuf: (w) => {
    let i = 1
    while (w[i]?.startsWith('-')) i += /^-[ioe]$/.test(w[i]!) ? 2 : 1
    return i
  },
}
const BARE_WRAPPERS = new Set(['time', 'nohup', 'builtin', 'noglob'])
const SAFE_ASSIGNMENTS = new Set([
  'NODE_ENV',
  'CI',
  'DEBUG',
  'FORCE_COLOR',
  'NO_COLOR',
  'LANG',
  'LC_ALL',
  'TZ',
  'RUST_BACKTRACE',
  'PYTHONUNBUFFERED',
])

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/

/** A subcommand as a rule sees it: wrappers and leading assignments removed. */
export function bashRuleSubject(command: string, forAllow: boolean): string | null {
  let words = command.trim().split(/\s+/).filter(Boolean)
  for (let guard = 0; guard < 16 && words.length > 0; guard++) {
    const head = words[0]!
    const assignment = ASSIGNMENT.exec(head)
    if (assignment) {
      if (forAllow && !SAFE_ASSIGNMENTS.has(assignment[1]!)) return null
      words = words.slice(1)
      continue
    }
    if (head === 'command' && words[1] !== '-v' && words[1] !== '-V') {
      words = words.slice(1)
      continue
    }
    if (head === 'xargs' && words[1] && !words[1].startsWith('-')) {
      words = words.slice(1)
      continue
    }
    if (BARE_WRAPPERS.has(head)) {
      words = words.slice(1)
      continue
    }
    const skip = WRAPPERS_WITH_ARGS[head]
    if (skip) {
      words = words.slice(skip(words))
      continue
    }
    break
  }
  return words.join(' ')
}

/**
 * Every command a line runs, for a deny or ask rule: the split subcommands, and when the line
 * holds a substitution the split cannot see through, the pieces between its separators and the
 * substitutions' own contents too.
 */
function deniableSubcommands(command: string): string[] {
  const split = splitCompoundCommand(command)
  if (split) return split
  const inner = [...command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? '')
  const pieces = [command, ...inner].flatMap((part) => part.split(/&&|\|\||[;|&\n()]/))
  return pieces.map((piece) => piece.trim()).filter(Boolean)
}

export function bashRuleMatches(
  specifier: string,
  command: string,
  effect: 'allow' | 'ask' | 'deny',
): boolean {
  if (effect === 'allow') {
    // `npm test &&` cannot be split, and an unsplittable line is never approved by a rule.
    if (/(&&|\|\|)\s*$/.test(command.trim())) return false
    const split = splitCompoundCommand(command)
    if (!split || split.length === 0) return false
    return split.every((sub) => {
      const subject = bashRuleSubject(sub, true)
      return subject !== null && matchBashSpecifier(specifier, subject)
    })
  }
  return deniableSubcommands(command).some((sub) =>
    [sub, bashRuleSubject(sub, false)].some(
      (subject) => subject !== null && matchBashSpecifier(specifier, subject),
    ),
  )
}
