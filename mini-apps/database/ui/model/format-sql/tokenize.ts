// SQL tokenizer for the formatter: respects string literals, quoted identifiers,
// dollar-quoted strings, and comments (their contents are never rewritten), and keeps
// multi-char operators as single tokens.
import { KEYWORDS } from './vocab'

export interface Token {
  text: string
  /** 'word' | 'string' | 'comment' | 'punct' — drives spacing + casing. */
  kind: 'word' | 'string' | 'comment' | 'punct'
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  const n = sql.length
  let i = 0
  while (i < n) {
    const ch = sql[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // Comments — kept verbatim as their own token.
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i + 2)
      const end = nl === -1 ? n : nl
      tokens.push({ text: sql.slice(i, end), kind: 'comment' })
      i = end
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      tokens.push({ text: sql.slice(i, end), kind: 'comment' })
      i = end
      continue
    }
    // Dollar-quoted string (Postgres) `$tag$ … $tag$` — kept verbatim (its body may hold
    // semicolons/keywords/newlines that must not be reflowed). Checked before the word
    // scan because `$` is otherwise a word char.
    if (ch === '$') {
      const open = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
      if (open) {
        const tag = open[0]
        const close = sql.indexOf(tag, i + tag.length)
        const end = close === -1 ? n : close + tag.length
        tokens.push({ text: sql.slice(i, end), kind: 'string' })
        i = end
        continue
      }
    }
    // SQL Server bracket-quoted identifier — kept as one token so `[user id]` is never
    // rewritten to `[ user id ]` (which would name a different column).
    if (ch === '[') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ']') {
          if (sql[j + 1] === ']') {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      tokens.push({ text: sql.slice(i, j), kind: 'string' })
      i = j
      continue
    }
    // String / quoted identifier — kept verbatim (doubled quote escapes).
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      tokens.push({ text: sql.slice(i, j), kind: 'string' })
      i = j
      continue
    }
    // Word: identifier / keyword / number (incl. dotted a.b and $params).
    if (/[A-Za-z0-9_$.]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$.]/.test(sql[j])) j++
      tokens.push({ text: sql.slice(i, j), kind: 'word' })
      i = j
      continue
    }
    // Multi-char operators kept as ONE token so Format never splits `<=` into `< =`
    // (which would be invalid SQL). Longest match first (`->>` before `->`).
    const three = sql.slice(i, i + 3)
    if (three === '->>') {
      tokens.push({ text: three, kind: 'punct' })
      i += 3
      continue
    }
    const two = sql.slice(i, i + 2)
    if (
      two === '<=' ||
      two === '>=' ||
      two === '<>' ||
      two === '!=' ||
      two === '||' ||
      two === '::' ||
      two === '->' ||
      two === ':='
    ) {
      tokens.push({ text: two, kind: 'punct' })
      i += 2
      continue
    }
    // Everything else → a single-char punctuation/operator token.
    tokens.push({ text: ch, kind: 'punct' })
    i++
  }
  return tokens
}

/** True when the token is an uppercasable keyword. */
export function isKeyword(t: Token): boolean {
  return t.kind === 'word' && KEYWORDS.has(t.text.toUpperCase())
}
