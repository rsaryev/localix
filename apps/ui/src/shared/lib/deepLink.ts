// ── Deep links: localix:// → in-app hash route ────────────────────────────────
// The `localix` scheme is registered by the Tauri shell (tauri.conf.json
// plugins.deep-link.desktop.schemes). Incoming URLs are forwarded from Rust into
// the webview, which calls installDeepLinkHandler's callback with the raw URL.
// This module owns the pure URL→route grammar (shell-agnostic, unit-testable).
//
// Grammar is deliberately tiny — a foundation, not a router:
//   localix://session/<id>        → focus the window + navigate to #/chat/<id>
//   localix://project/<id>        → switch the active project (#/project/<id>; the
//                                   UI's URL→store sync selects the project and
//                                   resolves/creates its default session)
//   localix://new?prompt=<text>   → start a fresh global chat with the prompt
//                                   prefilled into the composer (#/?prompt=<text>;
//                                   the home route mints the draft, ChatPage feeds
//                                   the composer via composerBus)
//   localix://open?path=<abs>     → open a filesystem PATH: a directory becomes a
//                                   project (created if none exists for it), a file
//                                   opens in the chat on screen without touching the
//                                   project. Unlike the routes above this can't map to
//                                   a static hash — it needs a server round-trip (file
//                                   or directory?) — so it surfaces as an `open` INTENT
//                                   the app resolves asynchronously. `&new=1` parses
//                                   as `fresh`, which no handler reads yet.
// Unrecognized URLs are ignored, never navigated.

/** Session/project ids the UI mints (nanoid/uuid-style) — conservative charset guard. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Deep-link prompts are composer prefill, not payload transport — keep them sane. */
const MAX_PROMPT_LENGTH = 4000

/** Guard against absurd paths. */
const MAX_PATH_LENGTH = 4096

/**
 * A deep-link path must be ABSOLUTE. This used to say "transport, not validation — the app
 * re-checks", and nothing re-checked: `resolveProjectByPath` normalizes with `path.normalize`,
 * which does not make a path absolute, then finds-or-CREATES a project with whatever it was
 * handed. So `localix://open?path=../../etc` minted a project whose `workingDir` is relative —
 * incoherent by construction, since every tool would resolve it against whatever cwd it
 * happens to run in.
 *
 * Windows forms count too: this parser is shared by every desktop platform the Tauri shell
 * runs on, and a drive-relative `C:foo` is as broken as `../foo`.
 */
function isAbsolutePath(value: string): boolean {
  if (value.startsWith('/')) return true // POSIX, and UNC's leading slashes
  if (value.startsWith('\\\\')) return true // \\server\share (UNC)
  return /^[A-Za-z]:[\\/]/.test(value) // C:\… or C:/… — but NOT drive-relative C:foo
}

/**
 * Control characters have no place in a path that arrives from OUTSIDE the app (a web page, a
 * mail client, another program can all hand the OS a `localix://` URL). A NUL truncates the
 * path for anything that reaches libc, so what the user is shown and what gets opened can
 * differ.
 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return true
  }
  return false
}

/**
 * A parsed deep link. Most links address a static SPA hash route (`route`); the
 * `open` link carries a filesystem path the app must resolve via the server
 * before it knows where to navigate.
 */
export type DeepLinkIntent =
  | { kind: 'route'; hash: string }
  | { kind: 'open'; path: string; fresh: boolean }

/**
 * Parse a `localix://…` URL into a structured intent, or null when the URL is not
 * part of the supported grammar. Pure — the caller performs any navigation / async
 * resolution. This is the single source of truth for the deep-link grammar.
 */
export function parseDeepLink(rawUrl: string): DeepLinkIntent | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'localix:') return null
  // localix://session/<id> parses as host "session" + pathname "/<id>".
  const segments = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'session' && segments.length === 1) {
    const sessionId = segments[0]!
    if (ID_RE.test(sessionId)) return { kind: 'route', hash: `#/chat/${sessionId}` }
  }
  if (url.hostname === 'project' && segments.length === 1) {
    const projectId = segments[0]!
    if (ID_RE.test(projectId)) return { kind: 'route', hash: `#/project/${projectId}` }
  }
  if (url.hostname === 'new' && segments.length === 0) {
    const prompt = url.searchParams.get('prompt') ?? ''
    if (prompt.length > MAX_PROMPT_LENGTH) return null
    return { kind: 'route', hash: prompt ? `#/?prompt=${encodeURIComponent(prompt)}` : '#/' }
  }
  if (url.hostname === 'open' && segments.length === 0) {
    const path = url.searchParams.get('path') ?? ''
    if (!path || path.length > MAX_PATH_LENGTH) return null
    if (!isAbsolutePath(path) || hasControlChars(path)) return null
    const fresh = url.searchParams.get('new') === '1'
    return { kind: 'open', path, fresh }
  }
  return null
}
