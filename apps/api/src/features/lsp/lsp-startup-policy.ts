import type { LspServerUnavailable } from './lsp-manager-types'

/** The names the editor shows for the servers Localix knows; any other shows its id. */
export const SERVER_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  deno: 'Deno',
  vue: 'Vue',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  html: 'HTML',
  json: 'JSON',
  css: 'CSS',
  dockerfile: 'Dockerfile',
  yaml: 'YAML',
}

/**
 * How long an install that could not finish stays reported before the next request for its file
 * tries again: soon for a dropped connection, a minute for a toolchain someone may be installing,
 * longer for a failure that will most likely repeat.
 */
export const INSTALL_RETRY_AFTER_MS: Record<LspServerUnavailable['reason'], number> = {
  offline: 30_000,
  'needs-toolchain': 60_000,
  failed: 5 * 60_000,
}
