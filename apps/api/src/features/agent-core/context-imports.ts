import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'

import { readCappedFile } from './context-read'

/**
 * Claude-Code-compatible `@import` expansion for context files.
 *
 * A line-anchored `@path` reference (a token starting with `@` that resolves to
 * an existing file) is expanded inline with a small header marker. References
 * inside Markdown code spans (`` `@x` ``) or fenced code blocks are skipped, so a
 * path can be mentioned literally by wrapping it in backticks. Imports recurse up
 * to {@link MAX_IMPORT_DEPTH} hops and are cycle-safe (a file already on the
 * current import stack is left literal). Each imported file is size-capped.
 *
 * Paths resolve relative to the importing file's directory, or as an absolute
 * path, or under `~/` (the user's home directory) — never relative to cwd. A project file's
 * imports stay inside the project (see {@link ImportEnv.confineTo}).
 */
export const MAX_IMPORT_DEPTH = 5
export const MAX_IMPORT_CHARS = 20_000

const IMPORT_TRUNCATION = '\n[... truncated: imported file exceeds the character budget]'

export interface ImportEnv {
  /** Override for the user's home directory (test seam). Defaults to os.homedir(). */
  homeDir?: string
  /**
   * The real path of the project an importing file belongs to. Set, every import (at any depth)
   * must resolve, symlinks followed, inside it; one that does not stays a marker, never content.
   * A checkout must not pull `~/.aws/credentials` into the prompt with one line.
   */
  confineTo?: string
}

/** The real path of an import target, when it lies inside `root` (itself a real path). */
async function realWithin(path: string, root: string): Promise<string | null> {
  try {
    const real = await realpath(path)
    return isPathWithin(root, real) ? real : null
  } catch {
    return null
  }
}

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  )

/** Resolve an `@`-import spec against the importing file's directory. */
function resolveImportPath(spec: string, baseDir: string, home: string): string | null {
  if (!spec) return null
  if (spec === '~') return home
  if (spec.startsWith('~/')) return join(home, spec.slice(2))
  if (isAbsolute(spec)) return spec
  return resolve(baseDir, spec)
}

/** Byte-index ranges of inline code spans (`` `...` ``) on a single line. */
function codeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const re = /`+/g
  let open: { index: number; len: number } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const len = m[0].length
    if (!open) {
      open = { index: m.index, len }
    } else if (open.len === len) {
      ranges.push([open.index, m.index + len])
      open = null
    }
  }
  return ranges
}

function insideAnyRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e)
}

/**
 * Read an imported file, capped to {@link MAX_IMPORT_CHARS}. Bounded by the shared
 * owner: an `@import` is the one context path a user can aim at an arbitrary file,
 * so it must not slurp a multi-MB target on every prompt assembly.
 */
const readCapped = (path: string): Promise<string | null> =>
  readCappedFile(path, { maxChars: MAX_IMPORT_CHARS, truncationMarker: IMPORT_TRUNCATION })

/**
 * Expand `@import` references in `content`. `baseDir` is the directory of the
 * file that owns `content` (imports resolve relative to it). Returns the content
 * with every valid, non-code-span import inlined behind a header marker.
 */
export async function expandImports(
  content: string,
  baseDir: string,
  env?: ImportEnv,
): Promise<string> {
  const home = env?.homeDir ?? homedir()
  return expand(content, baseDir, home, [], env?.confineTo)
}

async function expand(
  content: string,
  baseDir: string,
  home: string,
  stack: string[],
  confineTo: string | undefined,
): Promise<string> {
  if (stack.length >= MAX_IMPORT_DEPTH) return content

  const lines = content.split('\n')
  const out: string[] = []
  let inFence = false
  let fenceMarker = ''

  // A word starting with @, preceded by start-of-string or whitespace, whose
  // spec is a run of non-space, non-backtick chars. Trailing punctuation that is
  // clearly prose (a lone . , ; : ) ]) is trimmed off the candidate path.
  const importRe = /(^|\s)@([^\s`]+)/g

  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      const marker = fence[1][0].repeat(3)
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (fenceMarker === marker) {
        inFence = false
      }
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    const spans = codeSpanRanges(line)
    let rebuilt = ''
    let cursor = 0
    let matched = false
    let m: RegExpExecArray | null
    importRe.lastIndex = 0
    const inlined: string[] = []
    while ((m = importRe.exec(line))) {
      const atIndex = m.index + m[1].length
      if (insideAnyRange(atIndex, spans)) continue
      let spec = m[2]
      const trimmed = spec.replace(/[.,;:)\]]+$/, '')
      const resolvedPath = resolveImportPath(trimmed || spec, baseDir, home)
      if (!resolvedPath) continue
      const abs = resolve(resolvedPath)
      if (stack.includes(abs)) {
        // Cycle — leave the reference literal.
        continue
      }
      const target = confineTo ? await realWithin(abs, confineTo) : abs
      const body = target ? await readCapped(target) : null
      // Outside the project: say so only for a file that exists, so prose `@mentions` stay prose.
      if (body == null && (target || !(await isFile(abs)))) continue
      spec = trimmed || spec
      matched = true
      // Keep the text up to and including the reference, drop nothing from prose.
      rebuilt += line.slice(cursor, m.index + m[1].length) + `@${spec}`
      cursor = m.index + m[1].length + 1 + spec.length
      if (body == null) {
        inlined.push(`\n<!-- import skipped: ${abs} is outside the project -->`)
        continue
      }
      const expandedBody = await expand(body, dirname(abs), home, [...stack, abs], confineTo)
      inlined.push(`\n<!-- imported: ${abs} -->\n${expandedBody}\n<!-- end import: ${abs} -->`)
    }
    if (matched) {
      rebuilt += line.slice(cursor)
      out.push(rebuilt)
      for (const block of inlined) out.push(block)
    } else {
      out.push(line)
    }
  }

  return out.join('\n')
}
