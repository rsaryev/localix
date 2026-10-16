export interface CommandTextToken {
  value: string
  raw: string
  start: number
  end: number
  closed: boolean
  complete: boolean
}

/** Shared by the composer and server. Quoting is syntax; shell expansion never occurs. */
export function readCommandToken(text: string, from = 0): CommandTextToken | null {
  let start = from
  while (/\s/u.test(text[start] ?? '') && start < text.length) start++
  if (start === text.length) return null
  let end = start
  let value = ''
  let quote = ''
  for (; end < text.length; end++) {
    const char = text[end]!
    if (quote && char === '\\' && (text[end + 1] === quote || text[end + 1] === '\\')) value += text[++end]
    else if (quote) {
      if (char === quote) quote = ''
      else value += char
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/u.test(char)) break
    else value += char
  }
  return { value, raw: text.slice(start, end), start, end, closed: !quote, complete: !quote && end < text.length }
}

export function tokenizeCommandText(text: string): CommandTextToken[] {
  const tokens: CommandTextToken[] = []
  let offset = 0
  for (let token = readCommandToken(text, offset); token; token = readCommandToken(text, offset)) {
    tokens.push(token)
    offset = token.end
  }
  return tokens
}
