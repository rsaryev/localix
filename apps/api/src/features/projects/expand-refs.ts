/**
 * Server-side expansion of composer context references — the EXPANSION layer of
 * the ref-kind registry (`features/chat/context-ref-kinds.ts` owns the grammar).
 * One expander per kind, keyed by the same `kind` string; adding a kind =
 * registering one expander here. Filesystem kinds are strictly read-only and
 * path-confined to the given working directory (sensitive credential paths and
 * binary files rejected); workdir-free kinds (session/terminal/call) resolve via
 * loaders injected by the composition root so this module stays dependency-free.
 */
import path from 'node:path'
import { resolveWithin } from '../../lib/path-containment'
import { readFile, readdir, stat } from 'node:fs/promises'
import { hasBinarySignature } from '@localixai/plugin-sdk/backend'

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
 * What WAS wrong is that the adapter was ANONYMOUS, INLINE IN bootstrap.ts, AND MIRRORED:
 * `agent-core/resource-refs/resource-refs.test.ts` re-implemented it as a local
 * `hostLoader` in order to test the real path — a fake built from our own code. Let the
 * bootstrap copy drift (drop `language`, say) and that test stays green, because it is
 * asserting against its own reimplementation, not against the code that ships.
 *
 * So the adapter gets a NAME, and lives beside the strict type that demands it, where it
 * can be unit-tested once. The two defaults below are POLICY, not plumbing — they decide
 * what a provider's silence MEANS — and policy does not belong in a wiring file:
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

/** Max lines returned for a single @file ref. */
const MAX_FILE_LINES = 4000
/** Max bytes read from a single file before refusing. */
const MAX_FILE_BYTES = 1_500_000
/** Max entries in a @folder listing. */
const MAX_FOLDER_ENTRIES = 200

/** File basenames that are always blocked (credential files). */
const SENSITIVE_BASENAMES = [
  /^\.env(\..+)?$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /^id_dsa/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
  /^\.pypirc$/i,
  /\.pem$/i,
  /\.key$/i,
]

/** Directory segments that block any file inside them. */
const SENSITIVE_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.kube', '.gnupg'])

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  md: 'md',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  xml: 'xml',
  php: 'php',
  graphql: 'graphql',
}

function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return EXT_LANGUAGE[ext] ?? ''
}

function isSensitivePath(absPath: string): boolean {
  const base = path.basename(absPath)
  if (SENSITIVE_BASENAMES.some((re) => re.test(base))) return true
  return absPath.split(path.sep).some((seg) => SENSITIVE_DIR_SEGMENTS.has(seg))
}

/** Resolves `p` inside `workingDir`; returns null when it escapes the root. */
const confine = resolveWithin

function fail(ref: ContextRef, error: string): ContextRefExpansion {
  return { raw: ref.raw, ok: false, error, chars: 0 }
}

function succeed(
  ref: ContextRef,
  content: string,
  extra?: Partial<ContextRefExpansion>,
): ContextRefExpansion {
  return { raw: ref.raw, ok: true, content, chars: content.length, ...extra }
}

async function expandFile(workingDir: string, ref: ContextRef): Promise<ContextRefExpansion> {
  if (!ref.path) return fail(ref, 'missing path')
  const resolved = confine(workingDir, ref.path)
  if (!resolved) return fail(ref, 'path is outside the project working directory')
  if (isSensitivePath(resolved)) return fail(ref, 'path looks like a sensitive credential file')

  let info
  try {
    info = await stat(resolved)
  } catch {
    return fail(ref, 'file not found')
  }
  if (info.isDirectory()) return fail(ref, 'path is a directory — use @folder:')
  if (info.size > MAX_FILE_BYTES)
    return fail(ref, `file too large (${Math.round(info.size / 1024)}KB)`)

  const buffer = await readFile(resolved)
  if (hasBinarySignature(buffer)) return fail(ref, 'binary files are not supported')

  let lines = buffer.toString('utf8').split('\n')
  let rangeNote = ''
  if (ref.startLine) {
    const start = ref.startLine
    const end = ref.endLine ?? ref.startLine
    if (end >= start && start <= lines.length) {
      lines = lines.slice(start - 1, end)
    } else {
      // Invalid range falls through to the full file — but SAY so, or the model
      // silently gets 4000 lines when the user asked for one.
      const asked = end === start ? `line ${start}` : `lines ${start}-${end}`
      rangeNote = `[requested ${asked} is out of range — file has ${lines.length} lines; showing the full file]\n`
    }
  }
  const truncated = lines.length > MAX_FILE_LINES
  if (truncated) lines = lines.slice(0, MAX_FILE_LINES)
  let content = rangeNote + lines.join('\n')
  if (truncated) content += `\n[…truncated at ${MAX_FILE_LINES} lines…]`
  return succeed(ref, content, { language: languageForPath(resolved), truncated })
}

async function expandFolder(workingDir: string, ref: ContextRef): Promise<ContextRefExpansion> {
  const target = ref.path ?? '.'
  const resolved = confine(workingDir, target)
  if (!resolved) return fail(ref, 'path is outside the project working directory')
  if (isSensitivePath(resolved)) return fail(ref, 'path looks like a sensitive directory')

  let entries
  try {
    entries = await readdir(resolved, { withFileTypes: true })
  } catch {
    return fail(ref, 'folder not found')
  }
  const names = entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort((a, b) => {
      const aDir = a.endsWith('/')
      const bDir = b.endsWith('/')
      return aDir !== bDir ? (aDir ? -1 : 1) : a.localeCompare(b)
    })
  const truncated = names.length > MAX_FOLDER_ENTRIES
  const shown = truncated ? [...names.slice(0, MAX_FOLDER_ENTRIES), '…'] : names
  return succeed(ref, shown.map((n) => `- ${n}`).join('\n'), { truncated })
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
    if (!ref.path) return fail(ref, 'missing path')
    const resolved = confine(workingDir, ref.path)
    if (!resolved) return fail(ref, 'path is outside the project working directory')
    if (isSensitivePath(resolved)) return fail(ref, 'path looks like a sensitive credential file')
    let info
    try {
      info = await stat(resolved)
    } catch {
      return fail(ref, 'file not found')
    }
    if (info.isDirectory()) return fail(ref, 'path is a directory — use @folder:')
    if (ref.startLine) {
      // A line range → estimate proportionally (no read); a full file → the real byte size.
      const lineCount = Math.max(1, (ref.endLine ?? ref.startLine) - ref.startLine + 1)
      return {
        raw: ref.raw,
        ok: true,
        chars: Math.min(info.size, lineCount * APPROX_BYTES_PER_LINE),
        estimated: true,
      }
    }
    return { raw: ref.raw, ok: true, chars: info.size }
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
