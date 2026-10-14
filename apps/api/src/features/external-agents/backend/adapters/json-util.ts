/** Narrow, total accessors for provider JSON. Provider files are untrusted input: never assume a shape. */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Flatten a message `content` that may be a plain string or an array of typed blocks
 * (Anthropic-style `{type:'text'|'tool_use'|'tool_result', ...}`). Both shapes occur in Claude
 * Code transcripts; Codex and Gemini use their own but converge on `{text}` blocks.
 */
export function textOfContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const rec = asRecord(block)
    if (!rec) {
      if (typeof block === 'string') parts.push(block)
      continue
    }
    const text = asString(rec.text)
    if (text) {
      parts.push(text)
      continue
    }
    const name = asString(rec.name)
    if (rec.type === 'tool_use' && name) parts.push(`[tool: ${name}]`)
  }
  const joined = parts.join('\n').trim()
  return joined || undefined
}

/**
 * One block of a provider's message content, kept apart instead of flattened.
 *
 * `textOfContent` above renders a tool call as the placeholder `[tool: Bash]` because it exists to
 * answer "what does this message SAY" for a title or a digest. A transcript needs the opposite: the
 * call's name and arguments, so it can render as a tool card rather than as prose describing one.
 */
export type ContentPart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'tool_use'
      readonly id?: string
      readonly name: string
      readonly input?: unknown
    }
  | { readonly kind: 'tool_result'; readonly id?: string; readonly text: string }

/** Split message content into ordered parts, preserving the provider's own sequence. */
export function contentParts(content: unknown): ContentPart[] {
  if (typeof content === 'string') {
    const text = content.trim()
    return text ? [{ kind: 'text', text }] : []
  }
  if (!Array.isArray(content)) return []
  const parts: ContentPart[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      const text = block.trim()
      if (text) parts.push({ kind: 'text', text })
      continue
    }
    const rec = asRecord(block)
    if (!rec) continue
    const type = asString(rec.type)
    if (type === 'tool_use') {
      const name = asString(rec.name)
      // A call with no name cannot be rendered as one — it would be a card titled after nothing.
      if (name) parts.push({ kind: 'tool_use', id: asString(rec.id), name, input: rec.input })
      continue
    }
    if (type === 'tool_result') {
      const text = textOfContent(rec.content)
      parts.push({ kind: 'tool_result', id: asString(rec.tool_use_id), text: text ?? '' })
      continue
    }
    const text = asString(rec.text)
    if (text) parts.push({ kind: 'text', text })
  }
  return parts
}

/** First line of `text`, collapsed and clipped — used to derive a title from a prompt. */
export function firstText(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
