import { splitSkillArgs } from './slash-commands'

/**
 * The arguments a skill or command was invoked with, as its injected shell commands see them.
 * `raw` is the text typed after the command; `names` are its frontmatter `arguments`.
 */
export interface SkillShellArgs {
  raw: string
  names?: readonly string[]
}

/** One argument as a single shell word: `'…'`, an embedded `'` closed, escaped and reopened. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** An injected command with its arguments bound, ready to run. */
export interface BoundShellCommand {
  /** The script that runs: every placeholder became a reference to a variable in `env`. */
  command: string
  /** The argument values, one variable each. */
  env: Record<string, string>
  /** The command as a person reads it, each argument quoted in place: what a permission rule sees. */
  display: string
}

/** Where the values live: `$ARGUMENTS` in quotes is the text as typed, `$N` the Nth argument. */
const RAW_VAR = 'LOCALIX_SKILL_ARGUMENTS'
const argVar = (index: number) => `LOCALIX_SKILL_ARG_${index}`

type Quoting = 'none' | 'single' | 'double'

/** `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` or `$name` at the cursor. */
const PLACEHOLDER = /\$(ARGUMENTS(?:\[(\d+)\])?|(\d+)|([A-Za-z_][A-Za-z0-9_]*))/y

type Target = { kind: 'all' } | { kind: 'one'; index: number }

/**
 * Walk a command once, tracking its quoting, and hand each placeholder that names an argument to
 * `replace` with the quoting it sits in. A `\$` escape, an indexed placeholder with no argument
 * there and an unknown `$NAME` stay as written, for the shell to read as its own.
 */
function rewritePlaceholders(
  command: string,
  tokens: readonly string[],
  names: readonly string[],
  replace: (target: Target, quoting: Quoting) => string,
): string {
  let out = ''
  let quoting: Quoting = 'none'
  for (let i = 0; i < command.length;) {
    const ch = command[i]
    if (ch === '\\' && quoting !== 'single') {
      out += command.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === "'" && quoting !== 'double') quoting = quoting === 'single' ? 'none' : 'single'
    else if (ch === '"' && quoting !== 'single') quoting = quoting === 'double' ? 'none' : 'double'
    else if (ch === '$' && command[i - 1] !== '\\') {
      PLACEHOLDER.lastIndex = i
      const m = PLACEHOLDER.exec(command)
      const target = m ? targetOf(m, tokens, names) : undefined
      if (m && target) {
        out += replace(target, quoting)
        i += m[0].length
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

function targetOf(
  m: RegExpExecArray,
  tokens: readonly string[],
  names: readonly string[],
): Target | undefined {
  const [, token, bracket, bare, name] = m
  if (token === 'ARGUMENTS') return { kind: 'all' }
  const index = bracket ?? bare
  if (index !== undefined) {
    return tokens[Number(index)] === undefined ? undefined : { kind: 'one', index: Number(index) }
  }
  const position = name ? names.indexOf(name) : -1
  return position >= 0 ? { kind: 'one', index: position } : undefined
}

/** A variable reference that reads as one value in the quoting it lands in. */
function reference(variable: string, quoting: Quoting): string {
  if (quoting === 'double') return `\${${variable}}`
  // Close the authored single quote, expand in double quotes, reopen it.
  if (quoting === 'single') return `'"\${${variable}}"'`
  return `"\${${variable}}"`
}

/**
 * Claude Code inserts the arguments into a skill's content before its `` !`cmd` `` commands run,
 * so a command such as `"${CLAUDE_PLUGIN_ROOT}/setup.sh" $ARGUMENTS` receives them. Text the person
 * (or the model) typed must never become shell syntax, whatever quoting the author put around the
 * placeholder — `echo "$1"` and `echo '$ARGUMENTS'` are common — so the values are never spliced
 * into the script. Each placeholder becomes a reference to an environment variable holding the
 * value, and the shell does not parse an expanded value as code.
 *
 * Unquoted, `$ARGUMENTS` is every argument as its own word (the person's quoting groups words:
 * `--promise "A B"` is two), `$ARGUMENTS[N]` / `$N` the Nth, `$name` a declared argument. Inside
 * quotes, `$ARGUMENTS` is the text as typed.
 */
export function bindShellArgs(command: string, args: SkillShellArgs): BoundShellCommand {
  const raw = args.raw.trim()
  const tokens = splitSkillArgs(raw)
  const names = args.names ?? []
  const env: Record<string, string> = {}
  // An environment value cannot hold a NUL byte; it ends the C string the shell receives.
  const set = (variable: string, value: string) => (env[variable] = value.replaceAll('\0', ''))
  const bound = rewritePlaceholders(command, tokens, names, (target, quoting) => {
    if (target.kind === 'one') {
      set(argVar(target.index), tokens[target.index] ?? '')
      return reference(argVar(target.index), quoting)
    }
    if (quoting !== 'none') {
      set(RAW_VAR, raw)
      return reference(RAW_VAR, quoting)
    }
    return tokens
      .map((token, index) => (set(argVar(index), token), reference(argVar(index), 'none')))
      .join(' ')
  })
  const display = rewritePlaceholders(command, tokens, names, (target) =>
    target.kind === 'one'
      ? shellQuote(tokens[target.index] ?? '')
      : tokens.map(shellQuote).join(' '),
  )
  return { command: bound, env, display }
}

/**
 * The commands whose exit code 1 is a result, not a failure (no match, files differ), as Claude
 * Code's Bash tool counts them: `grep`, `rg`, `egrep`, `fgrep`, `find`, `diff`, `test`, `[`,
 * `git diff` and `git grep`. A script's status is its last command's, so that is the one read.
 */
const EXIT_ONE_IS_RESULT = /^(?:grep|rg|egrep|fgrep|find|diff|test|\[|git\s+(?:diff|grep))(?=\s|$)/

export function exitOneIsResult(command: string): boolean {
  const lines = command
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const last = (lines.at(-1) ?? '').split(/\|\||&&|[|;]/).at(-1) ?? ''
  return EXIT_ONE_IS_RESULT.test(last.trim())
}
