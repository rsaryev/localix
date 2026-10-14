import type { ReactNode } from 'react'

export type Lang = 'ts' | 'sql' | 'json' | 'sh'
type Rule = readonly [RegExp, string]

/** Just enough grammar for the snippets the scenes draw; classes map to the kit's syntax tokens. */
const RULES: Record<Lang, Rule[]> = {
  ts: [
    [/^\/\/.*/, 'c'],
    [/^'[^']*'|^"[^"]*"/, 's'],
    [/^(?:export|const|let|function|return|import|from|type|interface|await|async)\b/, 'k'],
    [/^(?:true|false|null|undefined)\b|^\d+(?:\.\d+)?/, 'n'],
    [/^[A-Z][\w$]*/, 't'],
    [/^[a-z_$][\w$]*(?=\()/, 'f'],
    [/^[a-z_$][\w$]*(?=\s*:)/, 'p'],
    [/^[\w$]+|^\s+/, ''],
    [/^[{}()[\]]/, 'b'],
    [/^./, 'x'],
  ],
  sql: [
    [/^'[^']*'/, 's'],
    [/^(?:SELECT|FROM|WHERE|ORDER|BY|AND|LIMIT|AS)\b/, 'k'],
    [/^\d+/, 'n'],
    [/^[a-z_][\w]*/, 'p'],
    [/^\s+/, ''],
    [/^./, 'x'],
  ],
  json: [
    [/^"[^"]*"(?=\s*:)/, 'p'],
    [/^"[^"]*"/, 's'],
    [/^(?:true|false|null|-?\d+(?:\.\d+)?)/, 'n'],
    [/^[{}[\]]/, 'b'],
    [/^\s+/, ''],
    [/^./, 'x'],
  ],
  sh: [
    [/^--?[\w-]+/, 'n'],
    [/^'[^']*'|^"[^"]*"/, 's'],
    [/^(?:claude|codex|bun|git)\b/, 'f'],
    [/^[\w./~-]+|^\s+/, ''],
    [/^./, 'x'],
  ],
}

export function tokenize(code: string, lang: Lang) {
  const tokens: { text: string; kind: string }[] = []
  let rest = code
  while (rest) {
    const [match, kind] = RULES[lang]
      .map(([pattern, kind]) => [pattern.exec(rest)?.[0], kind] as const)
      .find(([match]) => match) ?? [rest[0], '']
    const text = match ?? rest[0]
    const last = tokens.at(-1)
    if (last && last.kind === kind) last.text += text
    else tokens.push({ text, kind })
    rest = rest.slice(text.length)
  }
  return tokens
}

/** One highlighted line of code. */
export function Code({ lang, children }: { lang: Lang; children: string }): ReactNode {
  return tokenize(children, lang).map((token, i) =>
    token.kind ? (
      <span key={i} className={`t-${token.kind}`}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  )
}
