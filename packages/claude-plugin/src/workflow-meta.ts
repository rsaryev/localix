/**
 * A workflow (`workflows/*.js`): `export const meta = { name, description, whenToUse?, phases? }`
 * as the first statement, then a script body that orchestrates subagents. Claude Code reads `meta`
 * without running the script, so it must be a plain literal; one holding a variable, a call or a
 * spread drops the workflow from `/` autocomplete. A plugin's workflow runs as `/<plugin>:<name>`.
 */
export interface WorkflowMeta {
  name: string
  description: string
  whenToUse?: string
  phases?: Array<{ title: string; detail?: string; model?: string }>
}

/** Where `meta` ends and the body begins, with the parsed meta; or why it cannot be read. */
export type WorkflowMetaResult =
  | { meta: WorkflowMeta; body: string }
  | { error: string; meta?: undefined }

const META_HEAD = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*export\s+const\s+meta\s*=\s*/

/** Read a workflow script's `meta` literal and the body after it. */
export function parseWorkflowMeta(source: string): WorkflowMetaResult {
  const head = META_HEAD.exec(source)
  if (!head) return { error: '`export const meta = {…}` must be the first statement' }
  const reader = new LiteralReader(source, head[0].length)
  let value: unknown
  try {
    value = reader.value()
  } catch (error) {
    return { error: `meta is not a plain literal: ${(error as Error).message}` }
  }
  const meta = value as Record<string, unknown>
  if (typeof meta?.name !== 'string' || !meta.name.trim()) return { error: 'meta has no "name"' }
  if (typeof meta.description !== 'string') return { error: 'meta has no "description"' }
  const phases = Array.isArray(meta.phases)
    ? meta.phases.flatMap((phase) =>
        phase && typeof (phase as { title?: unknown }).title === 'string'
          ? [phase as { title: string; detail?: string; model?: string }]
          : [],
      )
    : undefined
  let end = reader.at
  while (/[\s;]/.test(source[end] ?? '')) end++
  return {
    meta: {
      name: meta.name.trim(),
      description: meta.description,
      ...(typeof meta.whenToUse === 'string' ? { whenToUse: meta.whenToUse } : {}),
      ...(phases ? { phases } : {}),
    },
    body: source.slice(end),
  }
}

/** A reader for the JavaScript literals `meta` may hold: objects, arrays, strings, numbers. */
class LiteralReader {
  private readonly text: string
  public at: number

  constructor(text: string, at: number) {
    this.text = text
    this.at = at
  }

  value(): unknown {
    this.space()
    const char = this.text[this.at]
    if (char === '{') return this.object()
    if (char === '[') return this.array()
    if (char === "'" || char === '"' || char === '`') return this.string()
    const word = /^(?:-?\d+(?:\.\d+)?|true|false|null)/.exec(this.text.slice(this.at))
    if (!word) throw new Error(`unexpected "${char ?? 'end of file'}"`)
    this.at += word[0].length
    return JSON.parse(word[0])
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    this.at++
    for (;;) {
      this.space()
      if (this.text[this.at] === '}') return (this.at++, out)
      const quoted = /['"]/.test(this.text[this.at] ?? '')
      const key = quoted ? this.string() : this.identifier()
      this.space()
      if (this.text[this.at] !== ':') throw new Error(`expected ":" after "${key}"`)
      this.at++
      out[key] = this.value()
      this.separator('}')
    }
  }

  private array(): unknown[] {
    const out: unknown[] = []
    this.at++
    for (;;) {
      this.space()
      if (this.text[this.at] === ']') return (this.at++, out)
      out.push(this.value())
      this.separator(']')
    }
  }

  private string(): string {
    const quote = this.text[this.at++]
    let out = ''
    while (this.text[this.at] !== quote) {
      const char = this.text[this.at++]
      if (char === undefined) throw new Error('unterminated string')
      if (quote === '`' && char === '$' && this.text[this.at] === '{')
        throw new Error('template interpolation')
      if (char !== '\\') {
        out += char
        continue
      }
      const next = this.text[this.at++]
      out += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '')
    }
    this.at++
    return out
  }

  private identifier(): string {
    const word = /^[A-Za-z_$][\w$]*/.exec(this.text.slice(this.at))
    if (!word) throw new Error(`unexpected "${this.text[this.at] ?? 'end of file'}"`)
    this.at += word[0].length
    return word[0]
  }

  private separator(close: string): void {
    this.space()
    if (this.text[this.at] === ',') this.at++
    else if (this.text[this.at] !== close) throw new Error(`expected "," or "${close}"`)
  }

  private space(): void {
    for (;;) {
      const rest = this.text.slice(this.at)
      const skip = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest)
      if (!skip) return
      this.at += skip[0].length
    }
  }
}
