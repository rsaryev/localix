/**
 * DOES THE COMMAND LINE RUN SOMETHING THE TOKENS DO NOT SHOW?
 *
 * shell-quote hands back `echo "$(touch x)"` and ``echo `touch x` `` as plain words — the
 * substitution survives as text inside a string token, indistinguishable from the literal
 * `echo '$(touch x)'`. A classifier that judged only the tokens therefore called both reads,
 * and in a read-only session that is arbitrary execution. Only the RAW text still says which
 * quote a `$(` sat in, so this scan walks it with the shell's own quoting rules.
 *
 * Fail-closed: anything that MAY execute counts, including a `<(`/`>(` inside double quotes
 * (literal there, but never needed by a read) and `${…@…}` (the `@P` transform re-expands a
 * value as a prompt string, which runs command substitutions stored in a variable).
 */

/** True when `command` contains a command/process substitution outside single quotes. */
export function hasHiddenExecution(command: string): boolean {
  let inDouble = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const next = command[i + 1]
    if (c === '$' && next === "'" && !inDouble) {
      // `$'…'` is literal too, but a backslash escapes its quote: `$'\''` is one quote
      // character, so ending at the first `'` would desynchronise every quote after it and
      // hide a later unquoted `$(…)` inside what the scan thinks is a quoted span.
      let j = i + 2
      while (j < command.length && command[j] !== "'") j += command[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === "'" && !inDouble) {
      // Single-quoted text is literal to the shell: jump to the closing quote. An unclosed
      // quote is a parse error the tokenizer reports, so stopping at the end is enough.
      const close = command.indexOf("'", i + 1)
      if (close < 0) return false
      i = close
      continue
    }
    if (c === '\\') {
      // An escaped character is literal (`\`` and `\$` both) — skip it.
      i++
      continue
    }
    if (c === '`') return true
    if (c === '$' && next === '(') return true
    if ((c === '<' || c === '>') && next === '(') return true
    if (c === '$' && next === '{') {
      const close = command.indexOf('}', i + 2)
      const body = close < 0 ? command.slice(i + 2) : command.slice(i + 2, close)
      if (body.includes('@')) return true
    }
    if (c === '"') inDouble = !inDouble
  }
  return false
}
