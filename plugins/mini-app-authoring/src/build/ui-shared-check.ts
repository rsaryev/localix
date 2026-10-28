import { escapeRegExp } from '../lib/regexp'

/**
 * A shared-module shim that the bundler wrapped in a function which never sets `exports`.
 *
 * The defect this guards: Bun treats a module resolved to the path `react` as the CommonJS package
 * it usually is, and a default import of it (zustand's `import React from 'react'`) made it wrap the
 * ESM shim as CommonJS. The wrapper kept `const { createContext, … } = m` as locals and exported
 * nothing, so every consumer read React from an empty object; the build succeeded and the Git mini
 * app's UI failed on load with "createContext is not a function". A shim is only ever read at the
 * top level of a chunk, or inside a wrapper that assigns `module.exports` (the preloaded shims are
 * CommonJS on purpose); anything else lost its exports.
 */
const SHIM_IN_WRAPPER = new RegExp(
  String.raw`(?:function\s*\([\w$,\s]*\)|\([\w$,\s]*\)\s*=>|[\w$]+\s*=>)\s*\{\s*` +
    String.raw`(?:var|let|const)\s+[\w$]+\s*=\s*(?:await\s+)?globalThis(?:\.|\[["'])$`,
  'u',
)
/** The host's shared-module registry, as the kit names it (`tools.ui.sharedGlobal`). */
const shimAccess = (sharedGlobal: string) =>
  new RegExp(
    `${escapeRegExp(sharedGlobal)}["']?\\]?\\.(?:require|load)\\(["']([^"']+)["']\\)`,
    'gu',
  )
const LOOKBEHIND = 160

/** The body of the block opening at `open`, string literals skipped; null if it never closes. */
function blockAt(code: string, open: number): string | null {
  let depth = 0
  for (let at = open; at < code.length; at++) {
    const char = code[at]
    if (char === '"' || char === "'" || char === '`') {
      for (at++; at < code.length && code[at] !== char; at++) if (code[at] === '\\') at++
    } else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return code.slice(open, at + 1)
  }
  return null
}

/** The shared specifiers whose shim, in this chunk, sits in a wrapper that exports nothing. */
export function sharedShimsWithoutExports(code: string, sharedGlobal: string): string[] {
  const lost: string[] = []
  for (const access of code.matchAll(shimAccess(sharedGlobal))) {
    const start = Math.max(0, access.index - LOOKBEHIND)
    const before = code.slice(start, access.index)
    const wrapper = SHIM_IN_WRAPPER.exec(before)
    if (!wrapper) continue
    const open = start + wrapper.index + wrapper[0].indexOf('{')
    const body = blockAt(code, open)
    if (body === null || !/\.exports\s*=/u.test(body)) lost.push(access[1]!)
  }
  return lost
}

/** Fail a build whose output carries a shared-module shim that lost its exports. */
export function assertSharedShimsExported(
  chunks: ReadonlyMap<string, string>,
  sharedGlobal: string,
): void {
  const problems = [...chunks].flatMap(([file, code]) =>
    [...new Set(sharedShimsWithoutExports(code, sharedGlobal))].map(
      (specifier) =>
        `${file}: the shared module "${specifier}" was bundled as CommonJS without exports, so every import of it would be empty at runtime`,
    ),
  )
  if (problems.length > 0) throw new Error(`UI build failed:\n${problems.join('\n')}`)
}
