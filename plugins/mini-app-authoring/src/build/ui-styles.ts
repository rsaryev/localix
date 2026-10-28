import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { Kit } from '../kit/kit'
import { isPathWithin } from '../lib/paths'

/**
 * The utilities a mini app's own sources use, compiled against the HOST theme — no preflight, no
 * theme tokens, nothing the host stylesheet already emits.
 *
 * Why here and with these inputs: the host stylesheet is not part of a mini app, and on an
 * installed app there is no source tree to reference. The kit carries the theme's stylesheets with
 * every import rewritten to a kit-relative path, so the compiler reads only files inside the kit.
 * The compiler is Tailwind's JavaScript core, which the kit carries so its version is the host's, and candidates are every class-shaped token of the
 * mini app's sources ({@link candidatesOf}; Tailwind ignores the ones that are not utilities) — no
 * native scanner binary, so the same build runs on every platform the app ships to.
 */

const SOURCE_DIR_NAMES = new Set(['ui', 'shared'])
const SKIP_DIR_NAMES = new Set(['backend', 'dist', 'node_modules', '.git'])
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|html|css|md)$/u
/** Tokens split at code punctuation too, so `class=flex` and `cn(open)` still yield the class. */
const CANDIDATE_FINE = /[^\s"'`<>{}=;,()\\]+/gu
/**
 * Tokens split only where a class string ends. A class may itself hold `(`, `)`, `,` and `=` —
 * `text-(--chart-2)`, `max-w-[min(26rem,100%)]`, `data-[state=open]:flex` — and the fine split
 * alone cut every one of those in pieces, so the utility was never generated and the mini app's
 * element silently rendered unstyled: an X drawn in the fallback colour, a board as wide as its pane.
 */
const CANDIDATE_WHOLE = /[^\s"'`<>{};\\]+/gu

/** Every class-shaped token of `text`, both ways; Tailwind ignores the ones that are not utilities. */
export function candidatesOf(text: string): string[] {
  return [...(text.match(CANDIDATE_WHOLE) ?? []), ...(text.match(CANDIDATE_FINE) ?? [])]
}

async function listSources(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return SKIP_DIR_NAMES.has(entry.name) ? [] : listSources(path)
      return SOURCE_EXT.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat()
}

/** A provider may keep its UI below its own folder (for example `kubernetes/ui`).
 * Discover those source roots before compiling; scanning only the mini app root's `ui` silently
 * drops layout utilities while the provider's JavaScript still bundles and renders. */
async function findSourceDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.flatMap((entry) => {
      if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name)) return []
      const path = join(dir, entry.name)
      return [SOURCE_DIR_NAMES.has(entry.name) ? Promise.resolve([path]) : findSourceDirs(path)]
    }),
  )
  return nested.flat()
}

export async function miniAppCandidates(miniAppDir: string): Promise<string[]> {
  const sourceDirs = await findSourceDirs(miniAppDir)
  const files = (await Promise.all(sourceDirs.map(listSources))).flat()
  const candidates = new Set<string>()
  for (const file of files) {
    for (const token of candidatesOf(await fs.readFile(file, 'utf8'))) candidates.add(token)
  }
  return [...candidates]
}

export async function buildMiniAppStylesheet(kit: Kit, miniAppDir: string): Promise<string> {
  const stylesRoot = join(kit.dir, kit.manifest.authoring.styles)
  const host = join(kit.dir, kit.manifest.hostStylesheet)
  const input = [
    `@reference ${JSON.stringify(host)};`,
    `@import ${JSON.stringify(join(kit.dir, kit.manifest.authoring.tailwindUtilities))} source(none);`,
  ].join('\n')
  const compiler = await kit.tools.compileTailwind(input, {
    base: dirname(host),
    loadStylesheet: async (id, base) => {
      const path = resolve(base, id)
      // The kit rewrote every import to a relative path; anything that leaves it is a broken kit.
      if (!isPathWithin(stylesRoot, path))
        throw new Error(`stylesheet outside the mini app kit: ${id}`)
      return { path, base: dirname(path), content: await fs.readFile(path, 'utf8') }
    },
    loadModule: async (id) => {
      throw new Error(`the host stylesheet loads no JavaScript (${id})`)
    },
  })
  return compiler.build(await miniAppCandidates(miniAppDir))
}
