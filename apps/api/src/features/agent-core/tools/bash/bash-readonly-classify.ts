import { parse, type ParseEntry } from 'shell-quote'
import { HEAD_ARG_RULES } from './bash-readonly-args'
import { isDangerous } from './bash-command-safety'
import { skipEnvOptions, WRAPPER_HEADS } from './bash-command-shape'
import { READONLY_HEADS } from './bash-readonly-heads'
import { hasHiddenExecution } from './bash-readonly-substitution'

/**
 * WHICH SHELL CALLS ONLY READ.
 *
 * Split from the danger classifier because the two answer opposite questions and change for
 * opposite reasons: that one grows when a new way to destroy something appears, this one when
 * a new way to inspect something does. They share only the fail-closed instinct.
 *
 * This verdict is what a read-only session runs WITHOUT asking, so a false "read" is arbitrary
 * execution there while a false "write" costs one confirmation. Every step below therefore
 * answers "not read-only" for anything it cannot positively classify.
 */

// ---- Read-only command classification ---------------------------------------
// We tokenize the command with shell-quote (a real lexer that respects quoting — so
// `echo "a > b"` is NOT seen as a redirect, which regex gets wrong) and require that EVERY
// pipeline/sequence segment has an allowlisted head, arguments its head's rule accepts
// (`bash-readonly-args.ts`), and no write redirects. A full shell parser would do the same job;
// for a synchronous classifier shell-quote's token stream is the right-sized tool.

/** Control operators that separate command segments. */
const CONTROL_OPS = new Set(['|', '||', '&&', ';', '&'])
/** Input redirects — these only READ, so they're allowed. */
const READ_REDIRECTS = new Set(['<', '<<', '<<<'])
const VERSION_FLAGS = new Set(['--version', '-v', '-V', 'version'])
/**
 * Heads for which `-v` is NOT a version flag. A shell or Python given `-v` alone starts an
 * interpreter in verbose mode that reads its program from stdin, and `ruby -v` prints the
 * version and then does the same — in a background job whose stdin the agent can write to,
 * that is arbitrary execution under a "read-only" verdict.
 */
const DASH_V_STARTS_INTERPRETER = /^(?:python[\d.]*|pypy[\d.]*|sh|bash|zsh|dash|ksh|fish|ruby|irb)$/
/**
 * Heads whose `version` SUBCOMMAND only prints. Elsewhere the word is an ordinary argument:
 * `npm version patch` rewrites package.json and tags the repo, `make version` runs a target.
 */
const VERSION_SUBCOMMAND_HEADS = new Set(['go', 'docker', 'kubectl', 'helm', 'terraform', 'deno'])

/**
 * Marks a word whose runtime value the tokens do not show. shell-quote silently replaces
 * `$X` with `""`, so `sed $X s/a/b/ f` looked like a plain sed while X could be `-i`; and an
 * unquoted glob such as `*` can expand to a file named `-i`. Both are opaque, and a head
 * whose arguments decide the verdict cannot be judged with one.
 */
const OPAQUE = '\u0000'
const GLOB_CAN_START_WITH_DASH = /^[*?[]/

/** `<head> --version` with nothing else (leading FOO=bar assignments allowed). */
function isVersionProbe(words: readonly string[]): boolean {
  // Leading FOO=bar assignments and bare fd numbers (the `2` of a `2>/dev/null` the token
  // loop already accepted) are not arguments.
  const args = words.filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && !/^\d+$/.test(w))
  if (args.length !== 2 || !VERSION_FLAGS.has(args[1]!)) return false
  // A bare PATH name only: `./install.sh -v` runs a script from the workspace, and a `$X`
  // head could be anything.
  const head = args[0]!
  if (head.includes('/') || head.includes(OPAQUE)) return false
  if (args[1] === '-v' && DASH_V_STARTS_INTERPRETER.test(head)) return false
  if (args[1] === 'version' && !VERSION_SUBCOMMAND_HEADS.has(head)) return false
  return true
}

/** Splits the tokens into command segments, or null when a token writes or is unknown. */
function segmentsOf(tokens: readonly ParseEntry[]): string[][] | null {
  const segments: string[][] = [[]]
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (typeof t === 'string') {
      segments[segments.length - 1]!.push(t)
      continue
    }
    if (t && 'comment' in t) continue // `# …` runs nothing
    if (!t || !('op' in t)) return null // anything else shell-quote emits
    const op = t.op
    if (op === 'glob') {
      const pattern = (t as { pattern: string }).pattern
      segments[segments.length - 1]!.push(
        GLOB_CAN_START_WITH_DASH.test(pattern) ? OPAQUE + pattern : pattern,
      )
      continue
    }
    if (CONTROL_OPS.has(op)) {
      segments.push([])
      continue
    }
    if (READ_REDIRECTS.has(op)) continue
    const next = tokens[i + 1]
    if (op === '>&') {
      // fd-dup (e.g. 2>&1) is read-only; `>&file` writes. Allow only when the
      // following token is a bare file descriptor number.
      if (typeof next === 'string' && /^\d+$/.test(next)) continue
      return null
    }
    if (op === '>' || op === '>>') {
      // A redirect to /dev/null discards output — it writes nothing, so it stays
      // read-only. This is the common `… 2>/dev/null` / `> /dev/null` idiom used to
      // silence noise during investigation. Any other target is a real write → reject.
      if (next === '/dev/null') {
        i++ // the target is the redirect's, not an argument of the command
        continue
      }
      return null
    }
    // '(' subshell or anything else → fail closed.
    return null
  }
  return segments
}

/** True when one command segment only reads. */
function isReadOnlySegment(words: readonly string[]): boolean {
  if (words.length === 0) return true // empty (trailing operator)
  // `bun --version`, `node -v`, `python3 -V`: a runtime asked ONLY for its version runs no
  // user code — the head is not on the read-only list because `node script.js` executes,
  // but this shape only prints. A read-only run probing its toolchain was refused for it.
  if (isVersionProbe(words)) return true
  let idx = 0
  let base: string
  let peeledWrapper = false
  for (;;) {
    while (words[idx] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[idx]!)) idx++ // skip FOO=bar
    const head = words[idx]
    // Nothing left after a wrapper is the wrapper's own read (`env VAR=1` prints the
    // environment). Nothing left without one is a bare assignment, which reads nothing.
    if (!head) return peeledWrapper
    base = head.split('/').pop() ?? head
    if (!READONLY_HEADS.has(base)) return false
    if (!WRAPPER_HEADS.has(base)) break
    peeledWrapper = true
    // A wrapper delegates: resolve the command it would run and judge THAT. With no
    // command left, `env` is only printing the environment, which is the read it is
    // allowlisted for.
    const afterOptions = skipEnvOptions(words, idx + 1)
    if (afterOptions === null) return false
    if (afterOptions >= words.length) return true
    idx = afterOptions
  }
  const rule = HEAD_ARG_RULES[base]
  if (!rule) return true // a head none of whose arguments can write
  const rest = words.slice(idx + 1)
  if (rest.some((w) => w.includes(OPAQUE))) return false
  return rule(rest)
}

export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim()
  if (!cmd) return true
  if (isDangerous(cmd)) return false
  // `$(…)`, backticks and process substitution run a command the tokens show only as text.
  if (hasHiddenExecution(cmd)) return false

  let segments: string[][] | null
  try {
    segments = segmentsOf(parse(cmd, (name) => `${OPAQUE}$${name}`))
  } catch {
    return false // unparseable → fail closed
  }
  return segments?.every(isReadOnlySegment) ?? false
}
