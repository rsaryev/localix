import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import { matchBashSpecifier } from './permission-value-match'

/**
 * A deny or ask `Bash(…)` rule of a Claude Code settings file against a command line, as Claude
 * Code matches it (permissions.md, "Compound commands", "Wrappers"):
 *
 *   - the line is split at `&&`, `||`, `;`, `|`, `&` and newlines, and the rule applies when any
 *     subcommand matches, including commands inside a substitution or a subshell;
 *   - `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob` and a bare
 *     `xargs` are stripped first, and so is any leading `VAR=value`, so `Bash(rm *)` matches
 *     `timeout 30 rm -rf x` and `FOO=1 rm x`.
 *
 * Allow rules are translated to Localix rows instead (`cc-rule-translate.ts`).
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

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/

/** A subcommand as a rule sees it: wrappers and leading assignments removed. */
export function bashRuleSubject(command: string): string {
  let words = command.trim().split(/\s+/).filter(Boolean)
  for (let guard = 0; guard < 16 && words.length > 0; guard++) {
    const head = words[0]!
    const assignment = ASSIGNMENT.exec(head)
    if (assignment) {
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

export function bashRuleMatches(specifier: string, command: string): boolean {
  return deniableSubcommands(command).some((sub) =>
    [sub, bashRuleSubject(sub)].some((subject) => matchBashSpecifier(specifier, subject)),
  )
}
