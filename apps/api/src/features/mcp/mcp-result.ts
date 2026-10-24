import { agentSourceId, type AgentSource, type AgentToolResult } from '@localixai/agent/agents'

import { envInt } from '../../lib/env'

/** Multimodal parts the MCP SDK can return from a tool call. */
export type McpContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource'
      resource: {
        uri: string
        text?: string
        blob?: string
        mimeType?: string
        title?: string
        name?: string
      }
    }
  | {
      type: 'resource_link'
      uri: string
      name?: string
      title?: string
      description?: string
      mimeType?: string
    }
  | { type: string; [k: string]: unknown }

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** Clamp an arbitrary MCP image mimeType to the media types our content parts allow. */
function normalizeImageMediaType(mime: string): ImageMediaType {
  const m = mime.toLowerCase()
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg'
  if (m === 'image/gif') return 'image/gif'
  if (m === 'image/webp') return 'image/webp'
  return 'image/png'
}

// A buggy or malicious MCP server can return an arbitrarily large result; built-in
// tools cap their output (read/bash truncateOutput) but MCP results flow straight
// into resultText (model-facing replay), so an uncapped multi-MB result would blow
// the token budget on every later turn. Bound the CUMULATIVE text across all parts
// (images are bounded separately by the run's image downscaling).
export const MCP_RESULT_DEFAULT_MAX_CHARS = 64_000
export const MCP_RESULT_MAX_PARTS = 128

/**
 * Host ceiling on what a tool ANNOTATION may raise the text cap to — Claude Code's own hard
 * ceiling for `anthropic/maxResultSizeChars` (mcp.md, "Raise the limit for a specific tool"),
 * bounded so the annotation cannot turn a per-call cap into no cap at all.
 *
 * Deliberately NOT the operator's `MAX_MCP_OUTPUT_TOKENS`: the operator is trusted and may set
 * that to anything, while the annotation comes from the server. Same asymmetry the rest of this
 * module already applies to parts and error messages.
 */
export const MCP_RESULT_MAX_ANNOTATION_CHARS = 500_000

const MCP_ERROR_TRUNCATION_MARKER = '\n[\u2026MCP error truncated to bound context]'

export function mcpAgentSource(input: {
  uri: string
  title?: string
  snippet?: string
  consulted: boolean
  provider?: string
  mimeType?: string
}): AgentSource | undefined {
  const uri = input.uri.trim()
  if (!uri) return undefined
  return {
    id: agentSourceId(uri, 'mcp-'),
    kind: 'resource',
    title: input.title?.trim() || uri,
    uri,
    role: input.consulted ? 'consulted' : 'discovered',
    status: 'available',
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.snippet?.trim() ? { snippet: input.snippet.trim().slice(0, 500) } : {}),
    ...(input.mimeType ? { metadata: { mimeType: input.mimeType } } : {}),
  }
}

/** UTF-8 byte length without allocating a second copy of a potentially huge string. */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Keep a UTF-8-safe prefix within `maxBytes`.
 *
 * MCP exceptions are untrusted server/transport data. Unlike normal MCP results,
 * they bypass `mapCallResult`, so cap them before the same message is copied into
 * model content, persisted error metadata, and the UI-facing error string.
 */
export function capMcpErrorMessage(
  message: string,
  maxBytes: number = MCP_RESULT_DEFAULT_MAX_CHARS,
): string {
  const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0
  // UTF-8 byte length can never be smaller than UTF-16 code-unit length. The
  // cheap length guard avoids scanning an attacker-sized string end-to-end when
  // it is already obviously above the fixed budget.
  if (message.length <= limit && utf8ByteLength(message) <= limit) return message
  if (limit === 0) return ''

  const markerBytes = utf8ByteLength(MCP_ERROR_TRUNCATION_MARKER)
  // Tiny third-party annotations may not leave room for the full marker. Still
  // honor the hard cap rather than allowing metadata to defeat the boundary.
  if (limit <= markerBytes) return '.'.repeat(limit)

  const contentBudget = limit - markerBytes
  let bytes = 0
  let end = 0
  for (const character of message) {
    const characterBytes = utf8ByteLength(character)
    if (bytes + characterBytes > contentBudget) break
    bytes += characterBytes
    end += character.length
  }
  return message.slice(0, end) + MCP_ERROR_TRUNCATION_MARKER
}

/**
 * Resolve the per-call TEXT character cap, CC-compatible:
 *   1. a tool's `anthropic/maxResultSizeChars` annotation wins (per-tool override);
 *   2. else `MAX_MCP_OUTPUT_TOKENS` (a token budget → chars ≈ ×4);
 *   3. else the built-in default.
 * Image content is bounded separately (run image downscaling), so this is text-only.
 */
export function resolveMcpResultMaxChars(
  annotationChars?: number,
  env: Record<string, string | undefined> = process.env,
): number {
  if (
    typeof annotationChars === 'number' &&
    Number.isFinite(annotationChars) &&
    annotationChars > 0
  ) {
    // CLAMPED. The annotation arrives in the server's own tool definition
    // (`readMaxResultChars` in mcp-tools.ts), so this is the party the cap constrains asking for
    // a bigger cap — and it was honoured verbatim. `anthropic/maxResultSizeChars: 100_000_000`
    // bought a 100 MB text result, which the wire pruner would later bound but the persisted
    // tool item and the UI stream would carry in full.
    //
    // Lowering it stays unrestricted: a server that knows its output is small is welcome to say
    // so. Raising it is bounded by the host, exactly as `MCP_RESULT_MAX_PARTS` already is — no
    // annotation raises the part count either.
    return Math.min(Math.floor(annotationChars), MCP_RESULT_MAX_ANNOTATION_CHARS)
  }
  // 0 = envInt's "unset or unparseable" sentinel (it only ever yields a positive int).
  const tokens = envInt('MAX_MCP_OUTPUT_TOKENS', 0, env)
  return tokens > 0 ? tokens * 4 : MCP_RESULT_DEFAULT_MAX_CHARS
}

/** Flatten MCP multimodal content into the text/contentParts an AgentToolResult expects. */
export function mapCallResult(
  content: McpContentPart[],
  isError: boolean,
  maxChars: number = MCP_RESULT_DEFAULT_MAX_CHARS,
  provenance: { provider?: string } = {},
): AgentToolResult {
  const textChunks: string[] = []
  const parts: AgentToolResult['contentParts'] = []
  const sources: AgentSource[] = []
  let textBudget = maxChars
  const inputParts = Array.isArray(content) ? content : []
  let truncated = !Array.isArray(content) || inputParts.length > MCP_RESULT_MAX_PARTS
  // Consume from a shared text budget so the joined `content` AND the text parts in
  // `contentParts` (whichever the wire uses) are both bounded. Returns null once the
  // budget is exhausted so the caller skips emptied parts.
  const takeText = (text: string): string | null => {
    if (textBudget <= 0) {
      truncated = true
      return null
    }
    const clipped = text.length > textBudget ? text.slice(0, textBudget) : text
    textBudget -= clipped.length
    if (clipped.length < text.length) truncated = true
    return clipped
  }

  for (const rawPart of inputParts.slice(0, MCP_RESULT_MAX_PARTS)) {
    if (typeof rawPart !== 'object' || rawPart === null) {
      const marker = takeText('[unknown]')
      if (marker !== null) textChunks.push(marker)
      continue
    }
    const part = rawPart as Record<string, unknown>
    if (part.type === 'text' && typeof part.text === 'string') {
      const text = takeText(part.text)
      if (text !== null) {
        textChunks.push(text)
        parts.push({ type: 'text', text })
      }
    } else if (
      part.type === 'image' &&
      typeof part.data === 'string' &&
      typeof part.mimeType === 'string'
    ) {
      parts.push({
        type: 'image',
        data: part.data,
        mediaType: normalizeImageMediaType(part.mimeType),
      })
      const marker = takeText('[image]')
      if (marker !== null) textChunks.push(marker)
    } else if (
      part.type === 'resource' &&
      typeof part.resource === 'object' &&
      part.resource !== null
    ) {
      const res = part.resource as Record<string, unknown>
      const uri = typeof res.uri === 'string' ? res.uri : ''
      const resourceText = typeof res.text === 'string' ? res.text : undefined
      const blob = typeof res.blob === 'string' ? res.blob : undefined
      const mimeType = typeof res.mimeType === 'string' ? res.mimeType : undefined
      const fallback = blob
        ? `[binary ${mimeType ?? 'data'} ${uri || 'resource'}]`
        : `[resource ${uri || 'unknown'}]`
      const text = takeText(resourceText ?? fallback)
      if (text !== null) {
        textChunks.push(text)
        parts.push({ type: 'text', text })
      }
      const source = mcpAgentSource({
        uri,
        title:
          typeof res.title === 'string'
            ? res.title
            : typeof res.name === 'string'
              ? res.name
              : undefined,
        snippet: resourceText,
        consulted: typeof resourceText === 'string' && text !== null && text.trim().length > 0,
        provider: provenance.provider,
        mimeType,
      })
      if (source) sources.push(source)
    } else if (part.type === 'resource_link' && typeof part.uri === 'string') {
      const marker = takeText(`[resource ${part.uri}]`)
      if (marker !== null) {
        textChunks.push(marker)
        parts.push({ type: 'text', text: marker })
      }
      const source = mcpAgentSource({
        uri: part.uri,
        title:
          typeof part.title === 'string'
            ? part.title
            : typeof part.name === 'string'
              ? part.name
              : undefined,
        snippet: typeof part.description === 'string' ? part.description : undefined,
        consulted: false,
        provider: provenance.provider,
        mimeType: typeof part.mimeType === 'string' ? part.mimeType : undefined,
      })
      if (source) sources.push(source)
    } else {
      // audio / unknown — represent as a short text marker so the model gets a signal.
      const marker = takeText(`[${typeof part.type === 'string' ? part.type : 'unknown'}]`)
      if (marker !== null) textChunks.push(marker)
    }
  }

  const marker = truncated ? `\n[…MCP result truncated at ${maxChars} chars to bound context]` : ''
  const text =
    (textChunks.join('\n').trim() || (isError ? 'MCP tool returned an error.' : '')) + marker
  const hasMedia = parts.some((p) => p.type !== 'text')
  return {
    content: text,
    contentParts: hasMedia ? parts : undefined,
    sources: sources.length ? sources : undefined,
    isError: isError || undefined,
  }
}
