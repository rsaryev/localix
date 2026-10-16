/** Pure construction, wire projection and model-facing formatting of context-ref payloads. */
import type { ContextRef, ContextRefExpansion } from '../projects/contracts'
import { DEFAULT_CONTEXT_WINDOW } from './runtime/agent-runner-constants'
import { refKindSpec, SNIPPET_CONTENT_MAX, type ContextRefKind } from './context-ref-kinds'

export interface ParsedContextRef extends ContextRef {
  /** Stable identity for dedup/exclusion — the normalized token. */
  key: string
}

/**
 * Renders a kind's `@`-token from its value — the INVERSE of the registry's `parse`.
 *
 * The registry was PARSE-ONLY, so every surface that needed to GO the other way
 * hand-rolled the grammar: the sidebar session-drag (`@session:${id}`), the chat-nav
 * URI→token map (`@project:`/`@session:`/`@message:`), even `makeMessageRef` INSIDE this
 * module. Same grammar, spelled in a dozen places — the drag sources and the parser had
 * already drifted apart once. One inverse, driven off the registry's optional
 * `RefKindSpec.token` so kind-specific encoding lives with its parser rather than
 * as a special case here.
 *
 * `value` is the token BODY — the id/path/uri after `@kind:` — e.g.
 * `refToken('message', `${sessionId}/${messageId}`)` → `@message:<sid>/<mid>`.
 */
export function refToken(kind: ContextRefKind, value: string): string {
  const spec = refKindSpec(kind)
  return spec.token ? spec.token(value) : `@${kind}:${value}`
}

/**
 * Formats ONE expansion as a self-contained model-facing block: a `--- @ref ---`
 * header + fenced content (fence picked longer than any backtick run inside).
 * A TRUNCATED expansion says so in the header — with a nudge to use tools for the
 * rest — so the agent never treats a clipped listing as the whole thing. Failed
 * expansions become a one-line warning instead, so the model knows the ref was
 * attempted (and that re-reading it itself is the recovery). This is the text a
 * `contextRef` attachment carries — emitted RAW on the wire (never re-fenced) and
 * hidden behind a pill in the transcript.
 */
export function formatRefExpansionBlock(exp: ContextRefExpansion): string {
  if (!exp.ok) {
    return `--- ${exp.raw} ---\n(could not expand: ${exp.error ?? 'unknown error'} — read it with your tools if you need it)`
  }
  // The language hint lands ON the fence line — strip anything that could break
  // out of it (newlines) or open a nested fence (backticks). Client-supplied.
  const lang = (exp.language ?? '').replace(/[`\r\n]/g, '')
  const body = exp.content ?? ''
  const longestRun = body.match(/`+/g)?.reduce((m, run) => Math.max(m, run.length), 0) ?? 0
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  // A snippet cut from a file names where — the model edits that span, not a search result.
  const where = exp.location ? ` from ${exp.location.replace(/[\r\n]/g, '')}` : ''
  const header = exp.truncated
    ? `--- ${exp.raw}${where} (truncated — read the source directly for the rest) ---`
    : `--- ${exp.raw}${where} ---`
  return `${header}\n${fence}${lang}\n${body}\n${fence}`
}

/**
 * Strips a ParsedContextRef down to the wire `ContextRef` shape for the send
 * payload (drops the client-only `key`; keeps only registry fields). Explicit
 * field list so an accidentally-widened parse result can't leak extra data.
 */
export function toWireRef(ref: ParsedContextRef): ContextRef {
  return {
    raw: ref.raw,
    kind: ref.kind,
    ...(ref.path !== undefined ? { path: ref.path } : {}),
    ...(ref.startLine !== undefined ? { startLine: ref.startLine } : {}),
    ...(ref.endLine !== undefined ? { endLine: ref.endLine } : {}),
    ...(ref.startColumn !== undefined ? { startColumn: ref.startColumn } : {}),
    ...(ref.endColumn !== undefined ? { endColumn: ref.endColumn } : {}),
    ...(ref.count !== undefined ? { count: ref.count } : {}),
    ...(ref.sessionId !== undefined ? { sessionId: ref.sessionId } : {}),
    ...(ref.projectId !== undefined ? { projectId: ref.projectId } : {}),
    ...(ref.messageId !== undefined ? { messageId: ref.messageId } : {}),
    ...(ref.terminalId !== undefined ? { terminalId: ref.terminalId } : {}),
    ...(ref.toolCallId !== undefined ? { toolCallId: ref.toolCallId } : {}),
    ...(ref.uri !== undefined ? { uri: ref.uri } : {}),
    // Snippet inline payload — the content IS the ref, so it must ride the wire.
    ...(ref.content !== undefined ? { content: ref.content } : {}),
    ...(ref.label !== undefined ? { label: ref.label } : {}),
    ...(ref.language !== undefined ? { language: ref.language } : {}),
  }
}

/** Synthetic `raw`/`key` for a `snippet` ref (never parsed from text). */
function snippetRaw(label: string): string {
  return refToken('snippet', label.trim() || 'snippet')
}

/**
 * Appended when a snippet capture exceeds {@link SNIPPET_CONTENT_MAX}. The size in
 * the text is DERIVED from the cap, not restated: the note is the only place the
 * user is told what the limit is, so a hardcoded "100 KB" would silently start
 * lying the moment the constant moved.
 */
const SNIPPET_TRUNCATION_NOTE = `\n… [snippet truncated: exceeded the ${SNIPPET_CONTENT_MAX / 1000} KB limit]`

/**
 * Clamps snippet content under the wire cap (`contextRefSchema.content`), keeping
 * a trailing truncation note INSIDE the cap so the model knows the capture was
 * cut. Without this an oversized drag (a long SQL Output log) would fail the
 * whole send at server-side schema validation.
 *
 * The SINGLE clamp for every composer surface — the web `sendRefs` and any other drag
 * path re-export this rather than re-implementing the cut (which drifted before: a
 * second copy used a different truncation note).
 */
export function clampSnippetContent(content: string): string {
  if (content.length <= SNIPPET_CONTENT_MAX) return content
  return (
    content.slice(0, SNIPPET_CONTENT_MAX - SNIPPET_TRUNCATION_NOTE.length) + SNIPPET_TRUNCATION_NOTE
  )
}

/**
 * Mints a `snippet` context-ref from CLIENT-side inline content — the token-less,
 * drag/attach-added path. Any surface (a SQL Output log, a text selection, a result
 * cell) builds one and hands it to the composer's structured refs (see
 * `useContextRefs` pinned refs); it never appears in the prompt text. The server
 * expander echoes `content` verbatim, fenced with `language`.
 */
export function makeSnippetRef(input: {
  label: string
  content: string
  language?: string
}): ParsedContextRef {
  const raw = snippetRaw(input.label)
  return {
    raw,
    key: raw,
    kind: 'snippet',
    label: input.label,
    content: clampSnippetContent(input.content),
    ...(input.language ? { language: input.language } : {}),
  }
}

/**
 * Mints a `message` context-ref — the STRUCTURED-ONLY, drag-minted "link this
 * transcript message" path (never typed). Carries the host `sessionId` +
 * `messageId` (ids only — the content is resolved fresh server-side, so a deleted
 * message degrades gracefully). `raw`/`key` is `@message:<sessionId>/<messageId>`,
 * a stable id that dedups correctly and never round-trips through `parseContextRefs`.
 */
export function makeMessageRef(input: {
  sessionId: string
  messageId: string
  label?: string
}): ParsedContextRef {
  const raw = refToken('message', `${input.sessionId}/${input.messageId}`)
  return {
    raw,
    key: raw,
    kind: 'message',
    sessionId: input.sessionId,
    messageId: input.messageId,
    ...(input.label ? { label: input.label } : {}),
  }
}

/**
 * Reconstructs a `message` ref from a sent message's `contextRef` attachment name
 * (`@message:<sessionId>/<messageId>`), for the transcript pill. The pill enriches
 * the label from the store; here we only recover the ids. Null when not a message id.
 */
export function messageRefFromRaw(raw: string): ParsedContextRef | null {
  if (!raw.startsWith('@message:')) return null
  const rest = raw.slice('@message:'.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  const sessionId = rest.slice(0, slash)
  const messageId = rest.slice(slash + 1)
  if (!sessionId || !messageId) return null
  return { raw, key: raw, kind: 'message', sessionId, messageId }
}

/**
 * Reconstructs a `snippet` ref from a sent message's `contextRef` attachment name
 * (`@snippet:<label>`), for the transcript pill. Content is NOT needed here (the
 * pill shows the label + icon only). Returns null when the name isn't a snippet id.
 */
export function snippetRefFromRaw(raw: string): ParsedContextRef | null {
  if (!raw.startsWith('@snippet:')) return null
  return { raw, key: raw, kind: 'snippet', label: raw.slice('@snippet:'.length) }
}

/** Sum of expanded characters across known expansions for the given refs. */
export function totalExpansionChars(
  refs: ParsedContextRef[],
  expansions: Map<string, ContextRefExpansion>,
  keyOf: (refKey: string) => string = (refKey) => refKey,
): number {
  let total = 0
  for (const ref of refs) total += expansions.get(keyOf(ref.key))?.chars ?? 0
  return total
}

/** chars/4 token heuristic. */
const CHARS_PER_TOKEN = 4
const WARN_FRACTION = 0.25
const BLOCK_FRACTION = 0.5

export type ExpansionBudget = 'ok' | 'warn' | 'block'

/** Classifies the expansion size against the model's context window. */
export function classifyExpansionBudget(
  totalChars: number,
  contextTokens: number | undefined,
): ExpansionBudget {
  const windowChars = (contextTokens || DEFAULT_CONTEXT_WINDOW) * CHARS_PER_TOKEN
  // Documented as warn ≥25% / block ≥50% — inclusive on the boundary.
  if (totalChars >= windowChars * BLOCK_FRACTION) return 'block'
  if (totalChars >= windowChars * WARN_FRACTION) return 'warn'
  return 'ok'
}
