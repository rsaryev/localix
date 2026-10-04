/**
 * WHEN DOES A `sed` CALL ONLY READ?
 *
 * `sed` is allowlisted as a read because `sed -n 1,10p f` is the everyday way to look at a
 * slice of a file. But the same binary edits in place (`-i`, `-i.bak`, `-ni`, `-Ei`,
 * `--in-place`, BSD `-I`, and GNU accepts them AFTER the operands too), writes files from its
 * script (`w FILE`, `W FILE`, the `s///w FILE` flag) and runs shell commands (GNU `e`, the
 * `s///e` flag). Comparing one word against `-i` let every other spelling through.
 *
 * So the verdict is positive, not a deny-list: every option must be a known harmless one and
 * the script must parse, command by command, into commands that cannot write or execute.
 * Anything this parser does not understand — a script file (`-f`), an unknown command, an
 * ambiguous regex — is answered "not read-only".
 */

/** Short options that change only how sed reads or prints. */
const SAFE_SHORTS = new Set(['n', 'E', 'r', 's', 'u', 'z'])
const SAFE_LONGS = new Set([
  'quiet',
  'silent',
  'regexp-extended',
  'separate',
  'unbuffered',
  'null-data',
  'posix',
  'debug',
  'sandbox',
])

/** `args` are the words after `sed`. True only when the options and script provably read. */
export function isReadOnlySed(args: readonly string[]): boolean {
  const scripts: string[] = []
  const operands: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
      if (name === 'expression') {
        const value = eq < 0 ? args[++i] : arg.slice(eq + 1)
        if (value === undefined) return false
        scripts.push(value)
        continue
      }
      if (eq < 0 && SAFE_LONGS.has(name)) continue
      return false // --in-place, --file, an abbreviation, anything unknown
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const c = arg[j]!
        if (c === 'e') {
          const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i]
          if (value === undefined) return false
          scripts.push(value)
          break
        }
        if (!SAFE_SHORTS.has(c)) return false // i, I, f, l, and anything unknown
      }
      continue
    }
    operands.push(arg)
  }
  if (scripts.length === 0) {
    const script = operands.shift()
    if (script === undefined) return false
    scripts.push(script)
  }
  return isReadOnlySedScript(scripts.join('\n'))
}

/** Commands that take no argument (an optional count for `l`/`q` is skipped separately). */
const PLAIN_COMMANDS = new Set([
  '}',
  '=',
  'd',
  'D',
  'g',
  'G',
  'h',
  'H',
  'n',
  'N',
  'p',
  'P',
  'x',
  'z',
  'F',
])
const COUNT_COMMANDS = new Set(['l', 'L', 'q', 'Q'])
/** Commands whose argument runs to the end of the line and is only text or a file READ. */
const LINE_COMMANDS = new Set(['a', 'i', 'c', 'r', 'R'])
const LABEL_COMMANDS = new Set([':', 'b', 't', 'T'])
const SAFE_S_FLAGS = /[gpiImM0-9]/

/** True when every command of the script only reads. Exported for its tests. */
export function isReadOnlySedScript(script: string): boolean {
  const s = script
  let i = 0
  const skip = (re: RegExp) => {
    while (i < s.length && re.test(s[i]!)) i++
  }
  // Reads a delimited regex/replacement body starting AFTER its opening delimiter. A
  // delimiter inside a bracket expression is where GNU (ends the regex) and BSD (keeps
  // going) disagree, so what follows could be flags to one and text to the other: refuse.
  const delimited = (delim: string, regex: boolean): boolean => {
    while (i < s.length) {
      const c = s[i]!
      if (c === '\\') i += 2
      else if (c === delim) {
        i++
        return true
      } else if (c === '\n') return false
      else if (c === '[' && regex) {
        let j = i + 1
        if (s[j] === '^') j++
        if (s[j] === ']') j++
        while (j < s.length && s[j] !== ']') {
          if (s[j] === delim || s[j] === '\n') return false
          j++
        }
        if (j >= s.length) return false
        i = j + 1
      } else i++
    }
    return false
  }
  // One address: a line number (with GNU `first~step`), `$`, or a `/re/` / `\cREc` regex.
  const address = (): 'none' | 'ok' | 'bad' => {
    const c = s[i]
    if (c !== undefined && /[0-9]/.test(c)) {
      skip(/[0-9~]/)
      return 'ok'
    }
    if (c === '$') {
      i++
      return 'ok'
    }
    if (c === '/' || c === '\\') {
      const delim = c === '/' ? '/' : s[i + 1]
      i += c === '/' ? 1 : 2
      if (!delim || delim === '\n' || delim === '\\' || !delimited(delim, true)) return 'bad'
      skip(/[IM]/)
      return 'ok'
    }
    return 'none'
  }

  for (;;) {
    skip(/[\s;]/)
    if (i >= s.length) return true
    if (s[i] === '#') {
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    const first = address()
    if (first === 'bad') return false
    if (first === 'ok' && s[i] === ',') {
      i++
      skip(/[ \t]/)
      if (s[i] === '+' || s[i] === '~') skip(/[+~0-9]/)
      else if (address() !== 'ok') return false
    }
    skip(/[ \t!]/)
    const cmd = s[i++]
    if (cmd === undefined) return false
    if (cmd === '{') continue // a block opens; its first command follows directly
    if (PLAIN_COMMANDS.has(cmd)) {
      // nothing to consume
    } else if (COUNT_COMMANDS.has(cmd)) {
      skip(/[ \t0-9]/)
    } else if (LINE_COMMANDS.has(cmd)) {
      while (i < s.length && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1
    } else if (LABEL_COMMANDS.has(cmd)) {
      // A label ends at the EARLIEST point any sed ends it (GNU stops at `;`, BSD reads to the
      // end of the line), so text that one sed runs as commands is checked as commands here.
      skip(/[ \t]/)
      while (i < s.length && !/[\s;}]/.test(s[i]!)) i++
    } else if (cmd === 's' || cmd === 'y') {
      const delim = s[i++]
      if (!delim || delim === '\n' || delim === '\\') return false
      if (!delimited(delim, true) || !delimited(delim, false)) return false
      if (cmd === 's') skip(SAFE_S_FLAGS) // a `w` or `e` flag stops here and fails below
    } else {
      return false // w, W, e, v and anything unknown
    }
    skip(/[ \t]/)
    if (i < s.length && !/[;\n}#]/.test(s[i]!)) return false
  }
}
