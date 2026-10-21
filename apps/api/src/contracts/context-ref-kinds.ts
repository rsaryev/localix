/**
 * REF-KIND REGISTRY — the single place a composer context-ref kind is defined.
 *
 * Every layer derives from this data instead of keeping its own regex/switch:
 *   - parse layer  (`context-refs.ts`): the shared token regex + per-kind parse,
 *     chip/menu labels, and the composer's reserved-word / atomic-token rules;
 *   - server layer (`features/projects/expand-refs.ts`): one expander per kind,
 *     keyed by the same `kind` string;
 *   - UI layer     (@-type menu entries, drag→token routing, chip labels).
 *
 * Adding a kind = ONE entry here (+ its server expander + optional UI listing).
 * Pure data + functions — no IO, no React, safe for client bundles.
 */

import type {
  ContextRefKind,
  RefKindSpec,
  ParseableRefKindSpec,
} from './context-ref-kind-contracts'
export {
  SNIPPET_CONTENT_MAX,
  type ContextRefKind,
  type RefKindSpec,
  type ParseableRefKindSpec,
} from './context-ref-kind-contracts'

/** Trailing sentence punctuation stripped off a token value (`see @file:a.ts.`). */
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"`]+$/

/** Basename of a forward-slashed path (pure, no node:path). */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/** Splits a `@file:` value into path + optional 1-indexed line range. */
function splitLineRange(value: string): { path: string; startLine?: number; endLine?: number } {
  const match = value.match(/^(.*?):(\d+)(?:-(\d+))?$/)
  if (!match) return { path: value }
  const startLine = Number(match[2])
  const endLine = match[3] ? Number(match[3]) : undefined
  if (!Number.isFinite(startLine) || startLine < 1) return { path: value }
  return { path: match[1], startLine, endLine }
}

const stripPunctuation = (value: string): string => value.replace(TRAILING_PUNCTUATION, '')

/** Encode each path segment while preserving `/` as the ref-path separator. */
function encodeRefPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Malformed hand-typed escapes stay literal instead of invalidating the whole ref. */
function decodeRefPath(path: string): string {
  try {
    return path.split('/').map(decodeURIComponent).join('/')
  } catch {
    return path
  }
}

/** The registry. Order = REF_RE alternation order = menu order. */
export const REF_KINDS: readonly RefKindSpec[] = [
  {
    kind: 'file',
    picker: 'path',
    needsWorkingDir: true,
    tokenPattern: 'file:\\S+',
    reservedWord: 'file:',
    uiTokenRe: /^file:/,
    parse(token) {
      const value = stripPunctuation(token.slice('file:'.length))
      if (!value) return null
      const { path: encodedPath, startLine, endLine } = splitLineRange(value)
      const path = decodeRefPath(encodedPath)
      if (!path) return null
      const rangeSuffix = startLine ? `:${startLine}${endLine ? `-${endLine}` : ''}` : ''
      return {
        raw: `@file:${encodedPath}${rangeSuffix}`,
        kind: 'file',
        path,
        startLine,
        endLine,
      }
    },
    token: (value) => `@file:${encodeRefPath(value)}`,
    label(ref) {
      const range = ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''
      return `${baseName(ref.path ?? '')}${range}`
    },
    menu: {
      label: '@file:',
      insert: '@file:',
      description: 'Attach file contents (path[:start-end])',
    },
  },
  {
    kind: 'folder',
    picker: 'path',
    needsWorkingDir: true,
    tokenPattern: 'folder:\\S+',
    reservedWord: 'folder:',
    uiTokenRe: /^folder:/,
    parse(token) {
      const value = stripPunctuation(token.slice('folder:'.length))
      if (!value) return null
      const encodedPath = value.replace(/\/+$/, '') || value
      const path = decodeRefPath(encodedPath)
      return { raw: `@folder:${encodedPath}`, kind: 'folder', path }
    },
    token: (value) => `@folder:${encodeRefPath(value)}`,
    label: (ref) => `${baseName(ref.path ?? '')}/`,
    menu: { label: '@folder:', insert: '@folder:', description: 'Attach a directory listing' },
  },
  {
    kind: 'session',
    picker: 'list',
    needsWorkingDir: false,
    tokenPattern: 'session:\\S+',
    reservedWord: 'session:',
    uiTokenRe: /^session:\S+$/,
    parse(token) {
      const sessionId = stripPunctuation(token.slice('session:'.length))
      if (!sessionId) return null
      return { raw: `@session:${sessionId}`, kind: 'session', sessionId }
    },
    label: (ref) => ref.sessionId ?? 'session',
    menu: {
      label: '@session:',
      insert: '@session:',
      description: 'Link another chat session (compact digest)',
    },
  },
  {
    // Link a PROJECT (folder scope) into chat — symmetric to `session`. Value is
    // the project id; the expander (loader-backed) resolves it to a compact digest
    // (name, working dir, session roster) — never creds/secrets/remote git config.
    kind: 'project',
    picker: 'list',
    needsWorkingDir: false,
    tokenPattern: 'project:\\S+',
    reservedWord: 'project:',
    uiTokenRe: /^project:\S+$/,
    parse(token) {
      const projectId = stripPunctuation(token.slice('project:'.length))
      if (!projectId) return null
      return { raw: `@project:${projectId}`, kind: 'project', projectId }
    },
    label: (ref) => ref.projectId ?? 'project',
    menu: {
      label: '@project:',
      insert: '@project:',
      description: 'Link a project (name, working dir, session roster)',
    },
  },
  {
    // Link a SINGLE transcript MESSAGE — STRUCTURED-ONLY (drag-minted from a message
    // row, never typed). Carries the host `sessionId` + `messageId`; the expander
    // (loader-backed) resolves the message fresh to its role + capped text, so a
    // since-deleted message degrades to a "could not expand" note. The synthetic
    // `raw` is `@message:<sessionId>/<messageId>` (stable key → correct dedup).
    kind: 'message',
    needsWorkingDir: false,
    structuredOnly: true,
    label: (ref) => (ref.messageId ? `message ${ref.messageId.slice(0, 8)}` : 'message'),
  },
  {
    kind: 'terminal',
    picker: 'list',
    needsWorkingDir: false,
    tokenPattern: 'terminal:\\S+',
    reservedWord: 'terminal:',
    uiTokenRe: /^terminal:\S+$/,
    parse(token) {
      const terminalId = stripPunctuation(token.slice('terminal:'.length))
      if (!terminalId) return null
      return { raw: `@terminal:${terminalId}`, kind: 'terminal', terminalId }
    },
    label: (ref) => `terminal ${(ref.terminalId ?? '').slice(0, 8)}`,
    menu: {
      label: '@terminal:',
      insert: '@terminal:',
      description: 'Link an open terminal (cwd, recent commands, output tail)',
    },
  },
  {
    kind: 'call',
    picker: 'list',
    needsWorkingDir: false,
    tokenPattern: 'call:\\S+',
    reservedWord: 'call:',
    uiTokenRe: /^call:\S+$/,
    parse(token) {
      const toolCallId = stripPunctuation(token.slice('call:'.length))
      if (!toolCallId) return null
      return { raw: `@call:${toolCallId}`, kind: 'call', toolCallId }
    },
    label: (ref) => `call ${(ref.toolCallId ?? '').slice(0, 10)}`,
    menu: {
      label: '@call:',
      insert: '@call:',
      description: 'Link a tool call from this session (input + result digest)',
    },
  },
  {
    // A generic RESOURCE link — its value is an opaque provider URI
    // (`localix://resource/<provider>/<id>/…`). The core knows only `resource` + the URI; a registered
    // `ResourceRefProvider` (agent-core resource-refs) owns the provider namespace. `/` inside
    // the URI is just URI path, not a filesystem segment (the `ref-path` slash
    // logic is scoped to file/folder modes only).
    kind: 'resource',
    picker: 'resource',
    needsWorkingDir: false,
    tokenPattern: 'resource:\\S+',
    reservedWord: 'resource:',
    uiTokenRe: /^resource:\S+$/,
    parse(token) {
      const uri = stripPunctuation(token.slice('resource:'.length))
      if (!uri) return null
      return { raw: `@resource:${uri}`, kind: 'resource', uri }
    },
    // Last non-empty URI segment (table/column name), computed generically.
    label: (ref) => baseName(ref.uri ?? '') || 'resource',
    menu: {
      label: '@resource:',
      insert: '@resource:',
      description:
        'Browse & link a resource — database, git, or chat (drill to a table, commit, or message)',
    },
  },
  {
    // A generic INLINE-CONTENT link — its `content` travels ON the ref, so its
    // expansion is a verbatim echo (no id, no fetch, no working dir). STRUCTURED-ONLY:
    // drag/attach-added (a SQL Output log, a text selection, a result cell), NEVER
    // typed — hence no token grammar, reserved word, or `@`-menu entry. The client
    // mints one via `makeSnippetRef` (context-refs.ts); `raw` is a synthetic
    // `@snippet:<label>` id that never round-trips through `parseContextRefs`.
    kind: 'snippet',
    needsWorkingDir: false,
    structuredOnly: true,
    label: (ref) =>
      ref.label ||
      (ref.raw.startsWith('@snippet:') ? ref.raw.slice('@snippet:'.length) : '') ||
      'snippet',
  },
]

/**
 * The typeable-from-text kinds — every kind EXCEPT `structuredOnly` ones. The parse
 * regex, reserved-word list, atomic-token test and the `@`-type menu all derive from
 * this (a structured-only kind like `snippet` is drag-only, so it must not appear as
 * a typeable `@` token anywhere). The type guard recovers the required grammar fields.
 */
export const PARSEABLE_REF_KINDS: readonly ParseableRefKindSpec[] = REF_KINDS.filter(
  (k): k is ParseableRefKindSpec => !k.structuredOnly,
)

/** Spec lookup by kind (registry order is short — linear scan is fine). */
export function refKindSpec(kind: ContextRefKind): RefKindSpec {
  const spec = REF_KINDS.find((k) => k.kind === kind)
  if (!spec) throw new Error(`unknown context-ref kind: ${kind}`)
  return spec
}

/** Reserved keywords (`file:`, `folder:`, …) the composer must not mention-ify.
 *  Structured-only kinds are never typed, so they carry no reserved word. */
export const REF_RESERVED_WORDS: readonly string[] = PARSEABLE_REF_KINDS.map((k) => k.reservedWord)

/**
 * Does a trimmed token body (after `@`, trailing punctuation stripped) read as
 * an atomic context-ref token to the composer (pill highlight + token Backspace)?
 * Structured-only kinds are never typed, so only the parseable kinds count.
 */
export function isAtomicRefToken(trimmedToken: string): boolean {
  return PARSEABLE_REF_KINDS.some((k) => k.uiTokenRe.test(trimmedToken))
}
