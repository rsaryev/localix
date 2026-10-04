// Pure path-selection for the "Follow the agent's edits" feature. Given the
// absolute paths carried by a `fs.changed` event (which mixes changed FILE paths
// with their parent DIRECTORY paths), pick the NORMAL editable code/text files the
// agent just wrote — the ones the editor should gently reveal so the user can watch
// the agent work.
//
// Complementary to `pickDocumentPaths` (contentTypeRouting): that keeps the
// dedicated-viewer documents (pdf/office/csv) the doc-auto-open router already
// handles; this keeps everything else that is a plain code/text source file. The
// two are mutually exclusive by construction (viewer docs are excluded here), so
// the two routers never fight over the same file.
//
// No React / DOM / network — just string math over paths, so the router's
// (stateful) dedup/active-session gate is the only untested part.

import { fileExtension, hasDedicatedViewer } from '@/shared/lib/contentTypeRouting'

/**
 * Extensions (no dot, lowercased) that identify a plain editable code/text file we
 * are willing to reveal. An allowlist (rather than a binary denylist) is the safe
 * default: a directory path or an extensionless file falls out (never revealed by
 * accident), an unknown/binary extension falls out, and only recognized source/text
 * formats pass. Kept intentionally broad across common source, config, and markup
 * formats — extend it as needed.
 */
export const CODE_EDITABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // JS / TS
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  // Web
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'astro',
  // Data / config (text)
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'xml',
  // Docs / markup (plain text, no dedicated viewer)
  'md',
  'markdown',
  'mdx',
  'txt',
  'rst',
  'tex',
  // Shell / scripting
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  // Popular languages
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'scala',
  'groovy',
  'gradle',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hh',
  'cs',
  'php',
  'swift',
  'm',
  'mm',
  'lua',
  'pl',
  'pm',
  'r',
  'dart',
  'ex',
  'exs',
  'erl',
  'hs',
  'clj',
  'cljs',
  // Query / schema / infra
  'sql',
  'graphql',
  'gql',
  'proto',
  'tf',
  'tfvars',
  'hcl',
])

/** True when this path is a normal editable code/text file worth revealing. */
export function isCodeEditablePath(path: string): boolean {
  // Skip dotfiles (`.gitignore`, `.eslintrc.json`, …) — noisy config the user
  // rarely wants yanked in front of them.
  const base = path.split(/[\\/]/).pop() ?? ''
  if (base.startsWith('.')) return false
  // Never steal a file the dedicated-viewer (document) router already owns.
  if (hasDedicatedViewer(path)) return false
  return CODE_EDITABLE_EXTENSIONS.has(fileExtension(path))
}

/**
 * Filter changed/absolute paths down to the code/text files worth revealing,
 * de-duped and order-preserving. Directories (no extension), dotfiles, viewer
 * documents, and binaries all fall out. Empty in → empty out (a no-op reveal).
 */
export function pickCodeEditablePaths(paths: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    if (seen.has(p) || !isCodeEditablePath(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/**
 * Pure decision for the follow-agent-edits router: given the feature toggle, whether
 * this event is for the ACTIVE session, the changed paths, and the per-session
 * already-revealed set, decide which single code file to gently reveal — or `null`
 * for a no-op. Returns the MOST-RECENT editable code file (the last matching path in
 * the event) so following a burst of writes tracks the file the agent is on now,
 * without opening a tab per file. `null` (no-op) when: the toggle is off, the event
 * is for a background/sub-agent session, no editable code file changed, the target
 * was already revealed (idempotent on replay/reconnect), or the per-session cap is
 * reached. The caller records the returned path into `seen`.
 */
export function decideFollowReveal(opts: {
  enabled: boolean
  isActiveSession: boolean
  paths: readonly string[]
  seen: ReadonlySet<string>
  maxOpened: number
}): string | null {
  if (!opts.enabled || !opts.isActiveSession) return null
  const candidates = pickCodeEditablePaths(opts.paths)
  if (candidates.length === 0) return null
  if (opts.seen.size >= opts.maxOpened) return null
  const target = candidates[candidates.length - 1]!
  if (opts.seen.has(target)) return null
  return target
}
