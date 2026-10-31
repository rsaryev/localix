// Pure helpers for detecting file references in rendered markdown, kept free of
// heavy imports (react-markdown / katex) so the matching rules stay unit-testable.

import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

// Bare filenames worth linking even without a directory (common config/source
// files). Excludes ambiguous member-access like `array.map` / `item.input`.
const CODE_FILE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|json|mdx?|css|scss|html?|py|rs|go|rb|java|sh|ya?ml|toml|sql|pdf|docx?|odt|pptx?|xlsx?|csv)$/i

export interface FileHrefReference {
  path: string
  line?: number
}

const FILE_LINE_HASH = /^#L?(\d+)(?:-L?\d+)?$/i

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function normalizedFilePath(value: string): string {
  return /^\/[a-z]:[\\/]/i.test(value) ? value.slice(1) : value
}

function validFilePath(value: string): boolean {
  if (!value || value.length > 4_096) return false
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return false
  }
  return true
}

function lineFromHash(hash: string): number | undefined {
  const match = FILE_LINE_HASH.exec(hash)
  if (!match) return undefined
  const line = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(line) && line > 0 ? line : undefined
}

function localixFileReference(href: string): FileHrefReference | null {
  const parsed = parseLocalixUri(href)
  if (
    parsed?.primitive !== 'ui' ||
    parsed.breadcrumbs.length !== 2 ||
    parsed.breadcrumbs[0] !== 'work-item' ||
    parsed.breadcrumbs[1] !== 'file'
  ) {
    return null
  }
  if (
    [...parsed.query.keys()].some((key) => key !== 'path' && key !== 'line') ||
    parsed.query.getAll('path').length !== 1 ||
    parsed.query.getAll('line').length > 1
  ) {
    return null
  }
  const path = parsed.query.get('path') ?? ''
  if (!validFilePath(path)) return null
  const rawLine = parsed.query.get('line')
  if (rawLine === null) return { path }
  if (!/^[1-9]\d*$/.test(rawLine)) return null
  const line = Number.parseInt(rawLine, 10)
  return Number.isSafeInteger(line) ? { path, line } : null
}

function schemeFileReference(href: string, scheme: 'sandbox:' | 'file:'): FileHrefReference | null {
  if (!href.toLowerCase().startsWith(scheme)) return null
  try {
    const parsed = new URL(href)
    if (
      parsed.protocol.toLowerCase() !== scheme ||
      parsed.host ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search
    ) {
      return null
    }
    const decoded = safeDecode(parsed.pathname)
    if (decoded === null) return null
    const path = normalizedFilePath(decoded)
    if (!validFilePath(path) || (!path.startsWith('/') && !/^[a-z]:[\\/]/i.test(path))) return null
    if (parsed.hash && lineFromHash(parsed.hash) === undefined) return null
    const line = lineFromHash(parsed.hash)
    return { path, ...(line ? { line } : {}) }
  } catch {
    return null
  }
}

/** Inline `code` text that names a file → its bare path (`:line` stripped), else null. */
export function inlineCodeToPath(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t)) return null // a real file token has no spaces
  const bare = t.replace(/:\d+(?::\d+)?$/, '') // drop a trailing :line[:col]
  if (bare.includes('/')) {
    return /^\.{0,2}\/?(?:[^/\s]+\/)+[^/\s]+\.\w+$/.test(bare) ? bare : null
  }
  return CODE_FILE_EXT.test(bare) ? bare : null
}

/** 1-indexed line from a `path:line[:col]` token (the line, not the column), else undefined. */
export function inlineCodeLine(text: string): number | undefined {
  const m = text.trim().match(/:(\d+)(?::\d+)?$/)
  return m ? Number.parseInt(m[1], 10) : undefined
}

/**
 * Resolve every supported local-file Markdown spelling into one canonical target:
 * Localix's own URI, model-written `sandbox:`, standard hostless `file:`, or a
 * workspace-relative/absolute path. Web and unknown schemes never become paths.
 */
export function fileHrefToReference(href?: string): FileHrefReference | null {
  if (!href) return null
  const localix = localixFileReference(href)
  if (localix) return localix
  if (/^localix:/i.test(href)) return null
  const sandbox = schemeFileReference(href, 'sandbox:')
  if (sandbox) return sandbox
  if (/^sandbox:/i.test(href)) return null
  const file = schemeFileReference(href, 'file:')
  if (file) return file
  if (/^file:/i.test(href)) return null
  // A drive letter is a path, not a URI scheme. Every other explicit scheme is
  // non-file and must never fall through into the inspector.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return null
  if (href.startsWith('#') || href.includes('?')) return null

  const hashAt = href.indexOf('#')
  const rawPath = hashAt >= 0 ? href.slice(0, hashAt) : href
  const hash = hashAt >= 0 ? href.slice(hashAt) : ''
  if (hash && lineFromHash(hash) === undefined) return null
  const decoded = safeDecode(rawPath)
  if (decoded === null) return null
  const path = normalizedFilePath(decoded)
  if (!validFilePath(path) || (!/\.[a-z0-9]+$/i.test(path) && !path.includes('/'))) return null
  const line = lineFromHash(hash)
  return { path, ...(line ? { line } : {}) }
}
