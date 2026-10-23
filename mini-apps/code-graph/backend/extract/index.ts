import type { LanguageId } from '../../shared/model'
import { extractGo } from './lang/go'
import { extractPython } from './lang/python'
import { extractTypeScript } from './lang/typescript'
import { parserFor } from './parser'
import { collectRefs } from './refs'
import type { FileExtraction } from './types'

/**
 * Bumped whenever an extractor's output changes for the same input. The cache keys every stored
 * extraction by it, so a fix reaches files that did not change — a cache keyed by content alone
 * kept serving the output of the bug it fixed.
 */
export const EXTRACTOR_VERSION = 3

/** Larger than this, a source file is almost always generated or vendored. */
export const MAX_FILE_BYTES = 1_000_000

const EXTENSIONS: Record<string, LanguageId> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
}

export function languageOf(path: string): LanguageId | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  if (/\.min\.[cm]?js$/.test(path)) return null
  return EXTENSIONS[path.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * A minified bundle parses into one enormous line of calls: every identifier becomes an edge to
 * nowhere and the file dwarfs the real code around it. A long first line is the tell.
 */
const MINIFIED_FIRST_LINE_CHARS = 2000
/** A file at least this long whose lines average over the limit below is generated, not written. */
const MINIFIED_MIN_FILE_CHARS = 20_000
const MINIFIED_AVERAGE_LINE_CHARS = 400

function looksMinified(text: string): boolean {
  const firstBreak = text.indexOf('\n')
  const firstLine = firstBreak < 0 ? text.length : firstBreak
  return (
    firstLine > MINIFIED_FIRST_LINE_CHARS ||
    (text.length > MINIFIED_MIN_FILE_CHARS &&
      text.length / countLines(text) > MINIFIED_AVERAGE_LINE_CHARS)
  )
}

function countLines(text: string): number {
  let lines = 1
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) {
    lines += 1
  }
  return text.endsWith('\n') ? lines - 1 : lines
}

/** One file's facts, or null for a file this mini app does not read (or should not). */
export async function extractFile(path: string, text: string): Promise<FileExtraction | null> {
  const language = languageOf(path)
  if (!language || text.length > MAX_FILE_BYTES || looksMinified(text)) return null
  const parser = await parserFor(language)
  const tree = parser.parse(text)
  if (!tree) return null
  // The tree lives in the WASM heap, not the JS one: nothing collects it, so it is freed here
  // whatever the walker did.
  try {
    const lines = countLines(text)
    const facts =
      language === 'python'
        ? extractPython(tree.rootNode, lines)
        : language === 'go'
          ? extractGo(tree.rootNode, lines)
          : extractTypeScript(tree.rootNode, language, lines)
    return { ...facts, refs: collectRefs(tree.rootNode, language) }
  } finally {
    tree.delete()
  }
}
