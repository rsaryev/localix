/**
 * Composer context references — pure parsing + message-building logic, shared by
 * every composer surface as a leaf subpath
 * (`@localixai/api/context-refs`). It owns only the text-level concerns so it stays
 * unit-testable without the network; expansion itself is done server-side via
 * `POST /rpc/projects/expand-refs`.
 *
 * Syntax (one line per registered kind — see `context-ref-kinds.ts`):
 *   @file:path/to/file.ts          — file contents
 *   @file:path/to/file.ts:10-25    — 1-indexed inclusive line range (or :42 single line)
 *   @folder:path/to/dir            — directory listing (names, not contents)
 *   @session:LOCALIX-42            — compact digest of another chat session
 *   @project:<projectId>           — compact project digest (name, working dir, sessions)
 *   @terminal:<id>                 — digest of an open terminal (id or unique prefix)
 *   @call:<toolCallId>             — digest of one tool call from this session
 *   @resource:localix://…          — an opaque registered-provider resource URI
 *
 * The `snippet` and `message` kinds are STRUCTURED-ONLY: they have NO `@`-token
 * grammar (never parsed from text). They are drag/attach-added (`makeSnippetRef` /
 * `makeMessageRef`) — a `snippet` carries its own inline `content` (echoed verbatim),
 * a `message` carries only `sessionId`+`messageId` (re-expanded fresh server-side).
 * See `PARSEABLE_REF_KINDS` — the typed-from-text subset the parse regex + menus
 * derive from.
 *
 * The token grammar, labels and menu entries all live in the REF-KIND REGISTRY
 * (`context-ref-kinds.ts`); this module derives the shared regex from it and owns
 * only the cross-kind mechanics (dedup parse, message assembly, size budget).
 *
 * On send the composer submits the ORIGINAL text (tokens in place) plus the parsed
 * refs as a structured field; the server expands them fresh at send time and attaches
 * each expansion as a model-only `contextRef` text attachment (see
 * `service/message-bindings.ts`) — the transcript stays clean (pills, not
 * fenced blocks).
 *
 * Zero server-graph imports: only value-free type imports from the projects
 * contract (pure zod) — safe to pull into a client bundle.
 */
import type { ContextRef, ContextRefExpansion } from '../projects/contracts'
export type { ContextRef } from '../projects/contracts'
import {
  PARSEABLE_REF_KINDS,
  REF_RESERVED_WORDS,
  refKindSpec,
  SNIPPET_CONTENT_MAX,
} from './context-ref-kinds'
import type { ContextRefKind } from './context-ref-kinds'

export {
  REF_KINDS,
  PARSEABLE_REF_KINDS,
  refKindSpec,
  REF_RESERVED_WORDS,
  isAtomicRefToken,
  baseName,
  SNIPPET_CONTENT_MAX,
  type RefKindSpec,
  type ParseableRefKindSpec,
  type ContextRefKind,
} from './context-ref-kinds'

export interface ParsedContextRef extends ContextRef {
  /** Stable identity for dedup/exclusion — the normalized token. */
  key: string
}

/**
 * Platform-neutral state for an open mention menu. A client owns token detection and
 * row building; the reset/dismissal/navigation semantics are owned HERE, so any surface
 * given the same token signature and selectable-row count behaves the same way.
 */
export interface MentionMenuState {
  signature: string | null
  index: number
  dismissedSignature: string | null
}

export type MentionMenuAction =
  | { type: 'sync'; signature: string | null; rowCount: number }
  | { type: 'move'; delta: -1 | 1; rowCount: number }
  | { type: 'dismiss' }

export const INITIAL_MENTION_MENU_STATE: MentionMenuState = {
  signature: null,
  index: 0,
  dismissedSignature: null,
}

/**
 * Pure mention lifecycle reducer. Navigation wraps, so Up from the first row and
 * Down from the last row have identical behavior on every composer surface. A changed token
 * signature resets selection and reopens a previously dismissed menu.
 */
export function reduceMentionMenu(
  state: MentionMenuState,
  action: MentionMenuAction,
): MentionMenuState {
  if (action.type === 'dismiss') {
    return state.signature ? { ...state, dismissedSignature: state.signature } : state
  }
  if (action.type === 'sync') {
    const changed = state.signature !== action.signature
    const rowCount = Math.max(0, action.rowCount)
    return {
      signature: action.signature,
      index: changed || rowCount === 0 ? 0 : Math.min(state.index, rowCount - 1),
      dismissedSignature: changed ? null : state.dismissedSignature,
    }
  }
  if (action.rowCount <= 0) return { ...state, index: 0 }
  const next = (state.index + action.delta + action.rowCount) % action.rowCount
  return { ...state, index: next }
}

/**
 * Matches @-references — the alternation of every registered kind's token
 * pattern, one capture group per kind (group index = registry index + 2).
 * Trailing punctuation is stripped by each kind's parse so `see @file:a.ts.`
 * works naturally.
 */
const REF_RE = new RegExp(
  `(^|\\s)@(?:${PARSEABLE_REF_KINDS.map((k) => `(${k.tokenPattern})`).join('|')})`,
  'g',
)

/** Parses every @-reference in `text` (deduplicated by key, in order). Only the
 *  PARSEABLE kinds are matched — structured-only kinds (e.g. `snippet`) are never
 *  typed, so `@snippet:foo` in prompt text is just plain words, not a ref. */
export function parseContextRefs(text: string): ParsedContextRef[] {
  const out: ParsedContextRef[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(REF_RE)) {
    const idx = PARSEABLE_REF_KINDS.findIndex((_, i) => match[i + 2] !== undefined)
    if (idx === -1) continue
    const ref = PARSEABLE_REF_KINDS[idx].parse(match[idx + 2])
    if (!ref || seen.has(ref.raw)) continue
    seen.add(ref.raw)
    out.push({ ...ref, key: ref.raw })
  }
  return out
}

/** Short human label for a chip / menu row (delegates to the kind registry). */
export function refLabel(ref: ParsedContextRef): string {
  return refKindSpec(ref.kind).label(ref)
}

/**
 * Renders a kind's `@`-token from its value — the INVERSE of the registry's `parse`.
 *
 * The registry was PARSE-ONLY, so every surface that needed to GO the other way
 * hand-rolled the grammar: the sidebar session-drag (`@session:${id}`), the chat-nav
 * URI→token map (`@project:`/`@session:`/`@message:`), even `makeMessageRef` INSIDE this
 * module. Same grammar, spelled in a dozen places — the drag sources and the parser had
 * already drifted apart once. One inverse, driven off the registry's optional
 * `RefKindSpec.token` so a kind whose grammar isn't `@kind:value` (only `diff`, which
 * takes no value) formats correctly without a special case here.
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

/** Default model window (tokens) when the catalog doesn't report one. */
const FALLBACK_CONTEXT_TOKENS = 128_000
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
  const windowChars = (contextTokens || FALLBACK_CONTEXT_TOKENS) * CHARS_PER_TOKEN
  // Documented as warn ≥25% / block ≥50% — inclusive on the boundary.
  if (totalChars >= windowChars * BLOCK_FRACTION) return 'block'
  if (totalChars >= windowChars * WARN_FRACTION) return 'warn'
  return 'ok'
}

/* ── Composer `@`-token detection ───────────────────────────────────────────────
 * The ONE detector every composer runs per keystroke (today: the web's
 * `useAtRefAutocomplete`): given the draft and the caret, find the `@`-token being
 * typed AT THE CARET and classify it into the menu mode that should open. Modes
 * derive from the registry's `picker` field, so a new kind routes itself.
 *
 * History: this lived in the web composer only (`prompt-input/atRefToken.ts`) while a
 * second composer kept a parallel hand-rolled grammar — which drifted (that menu missed
 * `@resource:` entirely). One detector, thin adapters.
 */

/** Menu mode for the token at the caret. `ref-path` = file/folder completion
 *  (see `kind`); a `picker: 'list' | 'resource'` kind uses its kind string. */
export type AtTokenMode =
  | 'type'
  | 'ref-path'
  | 'mention'
  | 'session'
  | 'project'
  | 'terminal'
  | 'call'
  | 'resource'

export interface TokenMatch {
  /** Index in the prompt where the `@` starts. */
  start: number
  /** Index just after the typed partial (= the caret position the token was
   *  detected at). Accepting replaces `[start, end)` and preserves any tail. */
  end: number
  mode: AtTokenMode
  /** For `ref-path`: which context-ref kind. */
  kind?: 'file' | 'folder'
  partial: string
}

/** A partial looks worth searching as a path mention once it has a slash, a dot,
 *  or is at least two chars (so a stray `@a` doesn't fire a search every keystroke). */
export function looksLikeMentionPartial(partial: string): boolean {
  return partial.includes('/') || partial.includes('.') || partial.length >= 2
}

/** Registry-derived: kinds completed by the directory picker vs a list/tree picker. */
const PATH_PICKER_KINDS = PARSEABLE_REF_KINDS.flatMap((k) => (k.picker === 'path' ? [k.kind] : []))
const LIST_PICKER_KINDS = PARSEABLE_REF_KINDS.flatMap((k) =>
  k.picker === 'list' || k.picker === 'resource' ? [k.kind] : [],
)
const PATH_TOKEN_RE = new RegExp(String.raw`(^|\s)@(${PATH_PICKER_KINDS.join('|')}):(\S*)$`)
const LIST_TOKEN_RE = new RegExp(String.raw`(^|\s)@(${LIST_PICKER_KINDS.join('|')}):(\S*)$`)

/** A bare partial that is a CONTINUATION of a colon-suffixed reserved word
 *  (`git:5`, `git:12`) — the value is still being typed, so neither the type
 *  menu nor the file-mention search applies (a mention search would hijack
 *  Enter and replace the valid token with a file path). */
function isReservedContinuation(partial: string): boolean {
  return PARSEABLE_REF_KINDS.some(
    (k) => k.reservedWord.endsWith(':') && partial.startsWith(k.reservedWord),
  )
}

/**
 * Detects an `@`-token being typed at the CARET (defaults to the end of the
 * prompt). Only the text BEFORE the caret is considered, so a caret parked
 * elsewhere (e.g. the user clicked back mid-text to edit a word) never
 * resurrects a menu for a token sitting at the end of the draft.
 */
export function detectToken(prompt: string, caret?: number | null): TokenMatch | null {
  const end = caret == null ? prompt.length : Math.max(0, Math.min(caret, prompt.length))
  const text = prompt.slice(0, end)
  // `@file:` / `@folder:` directory completion takes priority.
  const pathMatch = text.match(PATH_TOKEN_RE)
  if (pathMatch) {
    return {
      start: text.length - pathMatch[0].length + pathMatch[1].length,
      end,
      mode: 'ref-path',
      kind: pathMatch[2] as 'file' | 'folder',
      partial: pathMatch[3],
    }
  }
  // Pick-from-a-list / drill-a-tree completions (sessions, terminals, resources, …).
  const pickMatch = text.match(LIST_TOKEN_RE)
  if (pickMatch) {
    return {
      start: text.length - pickMatch[0].length + pickMatch[1].length,
      end,
      mode: pickMatch[2] as AtTokenMode,
      partial: pickMatch[3],
    }
  }
  // A regex mention search: `@/pattern` (the slash signals regex to the backend).
  const regexMatch = text.match(/(^|\s)@(\/\S*)$/)
  if (regexMatch) {
    return {
      start: text.length - regexMatch[0].length + regexMatch[1].length,
      end,
      mode: 'mention',
      partial: regexMatch[2],
    }
  }
  // A bare `@partial`. Reserved type words still in flight → type menu; a
  // path-like partial → mention search.
  const bare = text.match(/(^|\s)@([^\s@]*)$/)
  if (bare) {
    const partial = bare[2]
    const start = text.length - bare[0].length + bare[1].length
    // A partial that prefixes any context-ref keyword keeps the type menu open
    // (e.g. `@se` → `@session:`), instead of firing a file-mention search. A
    // CONTINUATION of a colon-suffixed keyword (`git:5`) is a token value still
    // being typed — stay in type mode (which offers nothing → menu closed)
    // rather than firing a bogus file search that hijacks Enter.
    const lower = partial.toLowerCase()
    const reserved =
      partial.length > 0 &&
      (REF_RESERVED_WORDS.some((w) => w.startsWith(lower)) || isReservedContinuation(lower))
    if (looksLikeMentionPartial(partial) && !reserved) {
      return { start, end, mode: 'mention', partial }
    }
    return { start, end, mode: 'type', partial }
  }
  return null
}

/* ── `@resource:` drill-down navigation ─────────────────────────────────────────
 * Given the partial the user has typed after `resource:` (an opaque provider URI
 * like `localix://resource/catalog/c1/public/`), compute the CONTAINER whose children to list plus the
 * trailing SEGMENT to filter them by. `GET /rpc/resource-refs?parent=&q=` is the
 * source of truth for the children; this only decides which parent to ask for.
 *
 * The `://` scheme separator is atomic, so the slash inside it is never mistaken for
 * a path boundary. Lives here (not in a client) because every composer's `@`-menu
 * drills with exactly this math.
 */

export {
  flattenResourceBrowse,
  resourceBrowseFailureNotice,
  resourceDrillPartial,
  resourceNav,
  resourceParentPartial,
  type ResourceBrowseResult,
  type ResourceNavTarget,
} from '@localixai/plugin-sdk/resource-refs'
