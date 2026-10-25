import { parse } from 'shell-quote'

/**
 * Split a pasted one-line command (`npx -y @scope/server --env=FOO="a b"`) into argv — the ONE
 * splitter for the Store's MCP form (`store-fields.ts`). Two hand-rolled regex copies split
 * `--env=FOO="a b"` into `--env=FOO=` + `a b`, ignored `\ ` escapes and dropped a deliberate `""`.
 *
 * shell-quote does the lexing (quotes, adjacency, escapes). The argv is spawned directly, never
 * through a shell, so the shell features shell-quote would ALSO apply are wrong here and are
 * neutralised before it sees the line:
 *   - `$VAR` / `${VAR:-x}` stay verbatim — `features/mcp/expand.ts` owns `${…}` expansion, and an
 *     unbalanced `${` must not throw while someone is still typing;
 *   - `| & ; ( ) < > #` and backticks are literal characters, not operators or a comment
 *     (`foo#bar` is one argument, not `foo` plus a comment);
 *   - an unquoted backslash escapes only a character a shell would treat specially, so a pasted
 *     Windows path (`C:\Users\me\server.js`) keeps its separators.
 * shell-quote's object entries can then only be a glob (`*.js`), returned as the literal pattern.
 */
export function splitCommandLine(line: string): string[] {
  return parse(neutralize(line)).map((entry) => {
    if (typeof entry === 'string') return entry
    if ('pattern' in entry) return entry.pattern
    return 'op' in entry ? entry.op : ''
  })
}

/** Unquoted characters a shell would treat as syntax; escaped so they reach argv literally. */
const UNQUOTED_LITERAL = /[$`|&;()<>#]/
/** What an unquoted backslash may escape; before anything else it is a literal backslash. */
const UNQUOTED_ESCAPABLE = /[\s'"\\$`|&;()<>#*?]/

function neutralize(line: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    const next = line[i + 1]
    if (quote === "'") {
      out += c
      if (c === "'") quote = null
    } else if (quote === '"') {
      // Inside double quotes shell-quote already applies POSIX backslash rules; only `$` is
      // escaped so it is not expanded.
      if (c === '\\' && next !== undefined) {
        out += c + next
        i++
      } else {
        out += c === '$' ? '\\$' : c
        if (c === '"') quote = null
      }
    } else if (c === '\\') {
      if (next !== undefined && UNQUOTED_ESCAPABLE.test(next)) {
        out += c + next
        i++
      } else {
        out += '\\\\'
      }
    } else if (c === '"' || c === "'") {
      quote = c
      out += c
    } else {
      out += UNQUOTED_LITERAL.test(c) ? `\\${c}` : c
    }
  }
  // A quote still open at the end (mid-typing in the form) runs to the end of the line, rather
  // than shell-quote silently dropping it and splitting the quoted words apart.
  return quote ? out + quote : out
}

/** What needs no quoting: a word `splitCommandLine` reads back as itself. */
const BARE = /^[A-Za-z0-9_@%+=:,./~-]+$/

/**
 * The inverse of {@link splitCommandLine}: an argv as one line the form shows and the splitter
 * reads back unchanged. A word with anything else in it goes in single quotes, where nothing is
 * special; a quote inside it closes, is escaped and reopens.
 */
export function joinCommandLine(argv: readonly string[]): string {
  return argv
    .map((word) => (BARE.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`))
    .join(' ')
}
