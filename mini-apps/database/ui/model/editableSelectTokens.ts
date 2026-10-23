import type { DbDialect } from '../dbClient'
import { scanSqlRegions, sqlGrammarForDialect } from '../../shared/sql-regions'

export interface Token {
  text: string
  lower: string
}

/**
 * Blank every string literal and comment, keeping quoted IDENTIFIERS as code.
 *
 * The defect this stops: the provenance gate used to run its own dialect-blind stripper that
 * knew only `--`, flat `/* *\/` and `'…'`. A Postgres `$$it's$$` body therefore opened a fake
 * string at its apostrophe that swallowed a following `UNION SELECT … FROM admins`, and a
 * MySQL `# it's` comment did the same — the gate saw one plain table and offered row editing
 * over a result that also held another table's rows. The one dialect-aware scanner in
 * `shared/sql-regions.ts` already knows dollar quotes, `#` comments, nested comments and
 * backslash escapes per engine, so the gate reads its regions instead of keeping a copy.
 *
 * Identifier regions stay intact because provenance NEEDS them (`"public"."users"`); only their
 * contents' SQL-looking text is harmless there, since the tokenizer reads them as one name.
 * Offsets are preserved, which keeps any later position-based diagnostics honest.
 */
function maskLiteralsAndComments(sql: string, dialect: DbDialect): string {
  const masked = sql.split('')
  for (const region of scanSqlRegions(sql, sqlGrammarForDialect(dialect))) {
    if (region.kind === 'identifier') continue
    for (let index = region.start; index < region.end; index++) {
      if (masked[index] !== '\n') masked[index] = ' '
    }
  }
  return masked.join('')
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (/\s/.test(char)) {
      index++
      continue
    }
    if (char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char
      let text = ''
      index++
      while (index < sql.length) {
        if (sql[index] === close && sql[index + 1] === close) {
          text += close
          index += 2
          continue
        }
        if (sql[index] === close) {
          index++
          break
        }
        text += sql[index]
        index++
      }
      tokens.push({ text, lower: text.toLowerCase() })
      continue
    }
    const word = /^[A-Za-z_@$#][A-Za-z0-9_@$#]*/.exec(sql.slice(index))?.[0]
    if (word) {
      tokens.push({ text: word, lower: word.toLowerCase() })
      index += word.length
      continue
    }
    const number = /^[0-9][0-9.]*/.exec(sql.slice(index))?.[0]
    if (number) {
      tokens.push({ text: number, lower: number })
      index += number.length
      continue
    }
    tokens.push({ text: char, lower: char.toLowerCase() })
    index++
  }
  return tokens
}

/** The code tokens of `sql` when it holds exactly one statement, else null. */
export function singleStatementTokens(sql: string, dialect: DbDialect): Token[] | null {
  const tokens = tokenize(maskLiteralsAndComments(sql, dialect))
  const statements: Token[][] = []
  let current: Token[] = []
  for (const token of tokens) {
    if (token.text === ';') {
      if (current.length) statements.push(current)
      current = []
    } else {
      current.push(token)
    }
  }
  if (current.length) statements.push(current)
  return statements.length === 1 ? statements[0]! : null
}
