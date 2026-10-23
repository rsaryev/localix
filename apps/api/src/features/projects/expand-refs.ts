/**
 * Server-side expansion of composer context references — the EXPANSION layer of
 * the ref-kind registry (`contracts/context-ref-kinds.ts` owns the grammar).
 * One expander per kind, keyed by the same `kind` string; adding a kind =
 * registering one expander here. Filesystem kinds are strictly read-only and
 * path-confined to the given working directory (sensitive credential paths and
 * binary files rejected); workdir-free kinds (session/terminal/call) resolve via
 * loaders injected by the composition root so this module stays dependency-free.
 */
import { expandFile, expandFolder, statFileRef } from './expand-filesystem-refs'
import { fail, succeed } from './ref-expansion-result'

import type { ContextRef, ContextRefExpansion } from './contracts'

/**
 * Loads the pre-formatted compact digest for a `@session:<id>` ref. Injected by
 * the caller (bootstrap) so this module stays free of chat-repository imports;
 * returns null when the session does not exist / is not owned by the user.
 */
export type SessionDigestLoader = (sessionId: string) => Promise<string | null>

/**
 * Loads the digest for a `@terminal:<id>` ref (id or unique prefix). Injected by
 * bootstrap (reads the live terminal service); null = not found / ambiguous.
 */
export type TerminalDigestLoader = (terminalId: string) => Promise<string | null>

/**
 * Loads the digest for a `@call:<toolCallId>` ref, scoped to the SENDING session
 * (the service pre-binds userId + sessionId). Null = call not found / ambiguous.
 */
export type CallDigestLoader = (toolCallId: string) => Promise<string | null>

/**
 * Loads the compact digest for a `@project:<id>` ref (name, working dir, session
 * roster). Injected by bootstrap; null when the project does not exist / is not
 * owned by the user. Carries introspection ONLY — never creds/secrets/remote URLs.
 */
export type ProjectDigestLoader = (projectId: string) => Promise<string | null>

/**
 * Loads the digest for a `@message:<sessionId>/<messageId>` ref — one transcript
 * message's role + capped text. Injected by bootstrap (reads the chat repository);
 * null when the session/message no longer exists (graceful "could not expand").
 */
export type MessageDigestLoader = (sessionId: string, messageId: string) => Promise<string | null>

/**
 * Resolves a `@resource:<uri>` ref → its model-facing expansion. Injected by
 * bootstrap (a `ResourceProviderRegistry.expand` bound to the user), so this
 * module stays free of agent-core/database imports. Unlike the string-only
 * digest loaders it carries a fence-language hint (`sql` for DDL).
 */
export type ResourceExpansionResult =
  | { ok: true; content: string; language?: string }
  | { ok: false; error: string }
export type ResourceRefLoader = (uri: string) => Promise<ResourceExpansionResult>

/**
 * The resource REGISTRY's expansion shape, stated structurally.
 *
 * Deliberately not imported from `agent-core/resource-refs/provider.ts`: this module is
 * free of agent-core imports (see above), and it should stay that way. We restate only the
 * four fields we consume, so the coupling is a shape, not a dependency.
 */
export interface WeakResourceExpansion {
  ok: boolean
  content?: string
  language?: string
  error?: string
}

/**
 * The registry's weak bag → the discriminated result this module's loader requires.
 *
 * TWO CONTRACTS, ON PURPOSE. `ResourceExpansion` is the shape providers find natural
 * to RETURN: `ok` plus whichever fields apply.
 * `ResourceExpansionResult` is the shape this CONSUMER needs to READ: a union it can
 * narrow, with no `ok: true, content: undefined` hole to re-check at every use. Neither is
 * wrong, and a composition root adapting one port to another is a composition root doing
 * its job — so this is NOT "move the normalizer onto the registry" (that would force the
 * generic port to learn one consumer's preferred shape, for no gain).
 *
 * This named adapter is shared by bootstrap and tests. Its defaults express what a
 * provider's missing fields mean to the consumer:
 *
 *   - `ok` with no `content` → `''`. An expansion that succeeded but produced nothing is
 *     an EMPTY resource, not a failed one. (A ref to an empty table expands to nothing.)
 *   - `!ok` with no `error` → `'resource unavailable'`. A provider that fails silently
 *     must still produce a model-facing reason; a blank error would render an empty pill.
 */
export function toResourceExpansionResult(r: WeakResourceExpansion): ResourceExpansionResult {
  return r.ok
    ? { ok: true, content: r.content ?? '', language: r.language }
    : { ok: false, error: r.error ?? 'resource unavailable' }
}

export interface ExpandRefsOptions {
  loadSessionDigest?: SessionDigestLoader
  loadTerminalDigest?: TerminalDigestLoader
  loadCallDigest?: CallDigestLoader
  loadProjectDigest?: ProjectDigestLoader
  loadMessageDigest?: MessageDigestLoader
  loadResource?: ResourceRefLoader
}

/** Generic loader-backed expander for the workdir-free kinds. */
async function expandViaLoader(
  ref: ContextRef,
  id: string | undefined,
  loader: ((id: string) => Promise<string | null>) | undefined,
  what: string,
): Promise<ContextRefExpansion> {
  const trimmed = id?.trim()
  if (!trimmed) return fail(ref, `missing ${what} id`)
  if (!loader) return fail(ref, `${what} links are not available here`)
  const digest = await loader(trimmed)
  if (digest === null) return fail(ref, `${what} not found`)
  return succeed(ref, digest)
}

/**
 * Snippet expander — the ref carries its OWN inline content (client-minted,
 * drag/attach-added), so this is a verbatim echo: no fetch, no working dir, no
 * loader. Never throws on missing content (an empty snippet becomes a clear note so
 * the model knows the link was attempted). The `language` hint rides through for
 * fencing in `formatRefExpansionBlock`.
 */
function expandSnippet(ref: ContextRef): ContextRefExpansion {
  const content = ref.content ?? ''
  if (!content) return succeed(ref, '(empty snippet — no content was captured)')
  const location = snippetLocation(ref)
  return succeed(ref, content, {
    ...(ref.language ? { language: ref.language } : {}),
    ...(location ? { location } : {}),
  })
}

/**
 * `path:line:column-line:column` for a snippet cut from a file (an editor selection), or
 * undefined for free-floating text. The selection binding always carried the path and both
 * positions; only the label (`file.ts L4-L6`) reached the model, so it had the text but not
 * where to put an edit.
 */
export function snippetLocation(ref: ContextRef): string | undefined {
  if (!ref.path || !ref.startLine) return undefined
  const endLine = ref.endLine ?? ref.startLine
  if (ref.startColumn && ref.endColumn) {
    return `${ref.path}:${ref.startLine}:${ref.startColumn}-${endLine}:${ref.endColumn}`
  }
  return endLine === ref.startLine
    ? `${ref.path}:${ref.startLine}`
    : `${ref.path}:${ref.startLine}-${endLine}`
}

/** Message expander — loads ONE transcript message (host session + message id)
 *  fresh via the injected loader; a since-deleted message resolves to null → a
 *  graceful "could not expand" note. */
async function expandMessage(
  ref: ContextRef,
  options: ExpandRefsOptions,
): Promise<ContextRefExpansion> {
  const sessionId = ref.sessionId?.trim()
  const messageId = ref.messageId?.trim()
  if (!sessionId || !messageId) return fail(ref, 'missing message id')
  if (!options.loadMessageDigest) return fail(ref, 'message links are not available here')
  const digest = await options.loadMessageDigest(sessionId, messageId)
  if (digest === null) return fail(ref, 'message not found')
  return succeed(ref, digest)
}

/** Resource expander — dispatches to the injected scheme-aware resolver. */
async function expandResource(
  ref: ContextRef,
  options: ExpandRefsOptions,
): Promise<ContextRefExpansion> {
  const uri = ref.uri?.trim()
  if (!uri) return fail(ref, 'missing resource uri')
  if (!options.loadResource) return fail(ref, 'resource links are not available here')
  const result = await options.loadResource(uri)
  if (!result.ok) return fail(ref, result.error)
  return succeed(ref, result.content, result.language ? { language: result.language } : undefined)
}

/** Approx chars per line, for estimating a `@file:` line-range size without reading. */
const APPROX_BYTES_PER_LINE = 100

/**
 * Conservative per-kind size ESTIMATE (chars) for the `sizeOnly` preflight, used
 * only for kinds whose real size needs the heavy send-time fetch (a capped digest,
 * a provider expansion). These feed ONLY the chip label + the budget warn/block
 * threshold, so approximate is fine; every digest they cover is capped, so a fixed
 * estimate stays in the right order of magnitude. `file`/`snippet` are sized
 * precisely below and never read this table.
 */
const ESTIMATED_CHARS: Record<ContextRef['kind'], number> = {
  file: 0,
  snippet: 0,
  folder: 1500,
  session: 3000,
  project: 1500,
  message: 4000,
  terminal: 3000,
  call: 2000,
  resource: 3000,
}

/**
 * Cheap size estimate for one ref — the `sizeOnly` preflight path. NEVER runs the
 * heavy expander: no provider/DB/exchange/git call, no file read. `snippet` is
 * free (local content length); `file` uses a `stat` (bytes, no read) and keeps its
 * cheap existence/confinement/sensitive checks so a broken file link still previews
 * as failed; every other kind returns a conservative constant marked `estimated`.
 */
async function estimateRefSize(workingDir: string, ref: ContextRef): Promise<ContextRefExpansion> {
  if (ref.kind === 'snippet') {
    return { raw: ref.raw, ok: true, chars: (ref.content ?? '').length }
  }
  if (ref.kind === 'file') {
    const file = await statFileRef(workingDir, ref)
    if ('refused' in file) return file.refused
    if (ref.startLine) {
      // A line range → estimate proportionally (no read); a full file → the real byte size.
      const lineCount = Math.max(1, (ref.endLine ?? ref.startLine) - ref.startLine + 1)
      return {
        raw: ref.raw,
        ok: true,
        chars: Math.min(file.size, lineCount * APPROX_BYTES_PER_LINE),
        estimated: true,
      }
    }
    return { raw: ref.raw, ok: true, chars: file.size }
  }
  // folder/session/project/message/terminal/call/resource — a
  // conservative fixed estimate. The real size is only known at send.
  return { raw: ref.raw, ok: true, chars: ESTIMATED_CHARS[ref.kind] ?? 2000, estimated: true }
}

/** One expander per registered ref kind — the server half of the kind registry. */
type RefExpander = (
  ctx: { workingDir: string; options: ExpandRefsOptions },
  ref: ContextRef,
) => Promise<ContextRefExpansion>

const EXPANDERS: Record<ContextRef['kind'], RefExpander> = {
  file: (ctx, ref) => expandFile(ctx.workingDir, ref),
  folder: (ctx, ref) => expandFolder(ctx.workingDir, ref),
  session: (ctx, ref) =>
    expandViaLoader(ref, ref.sessionId, ctx.options.loadSessionDigest, 'session'),
  project: (ctx, ref) =>
    expandViaLoader(ref, ref.projectId, ctx.options.loadProjectDigest, 'project'),
  message: (ctx, ref) => expandMessage(ref, ctx.options),
  terminal: (ctx, ref) =>
    expandViaLoader(ref, ref.terminalId, ctx.options.loadTerminalDigest, 'terminal'),
  call: (ctx, ref) => expandViaLoader(ref, ref.toolCallId, ctx.options.loadCallDigest, 'tool call'),
  resource: (ctx, ref) => expandResource(ref, ctx.options),
  snippet: (_ctx, ref) => Promise.resolve(expandSnippet(ref)),
}

/**
 * Expands every ref against `workingDir` (workdir-free kinds use their injected
 * digest loaders instead). Errors are per-ref, never thrown.
 */
export async function expandContextRefs(
  workingDir: string,
  refs: ContextRef[],
  options: ExpandRefsOptions = {},
  sizeOnly = false,
): Promise<ContextRefExpansion[]> {
  const ctx = { workingDir, options }
  return Promise.all(
    refs.map(async (ref) => {
      try {
        // sizeOnly (the composer's link-time preflight) returns a cheap size estimate
        // and NEVER runs the heavy expander — the one full expansion is at send time.
        if (sizeOnly) return await estimateRefSize(workingDir, ref)
        const expander = EXPANDERS[ref.kind]
        if (!expander) return fail(ref, `unknown ref kind: ${ref.kind}`)
        return await expander(ctx, ref)
      } catch (err) {
        return fail(ref, err instanceof Error ? err.message : 'expansion failed')
      }
    }),
  )
}
