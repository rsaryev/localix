import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { Kit, ThemeTokens, UiTokenRule } from '../kit/kit'
import { lineAt, scanSources } from '../lib/scan'

/**
 * The house style, checked on a mini app the way Localix checks its own UI.
 *
 * A generated timer passed every build step with `<button className="rounded border px-4 py-2">`,
 * `text-red-500` and `bg-emerald-500`: it worked, and it looked like somebody else's app. The token
 * rules are Localix's and come from the kit (`tools.style`), plus the rule only a mini app needs: a
 * native form control where the kit has one. The kit's controls carry the focus ring, the control
 * heights and the tokens; a hand-written one has to remember all three.
 */

export const MINI_APP_STYLE_RULES: readonly UiTokenRule[] = [
  {
    name: 'native control',
    // A file, range, colour or hidden input has no kit counterpart; everything else does.
    pattern:
      /<(?:button|select|textarea)(?=[\s>/])|<input(?=[\s>/])(?![^>]*\btype=["'](?:file|range|color|hidden)["'])/gu,
    fix: 'use the kit control — Button or IconButton (@localixai/kit/button, @localixai/kit/icon-button), Input, Select, Textarea, Switch, Checkbox',
  },
]

const SOURCES = ['ui/**/*.{ts,tsx}', 'shared/**/*.tsx']
const MAX_REPORTED = 25
const isTest = (file: string) => /\.(?:dom\.)?test\.tsx?$/u.test(file)

async function cssFilesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return cssFilesUnder(path)
      return entry.name.endsWith('.css') ? [path] : []
    }),
  )
  return nested.flat()
}

/**
 * The tokens the host theme declares, read from the stylesheets the kit carries — the same files a
 * mini app's utilities are compiled against. A kit whose theme declares no colour is broken, not a
 * mini app with no problems, so it throws and the step reports an error instead.
 */
async function kitThemeTokens(kit: Kit): Promise<ThemeTokens> {
  const files = await cssFilesUnder(join(kit.dir, kit.manifest.authoring.styles))
  const tokens = kit.tools.style.themeTokensOf(
    ...(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))),
  )
  if (tokens.colors.size === 0) {
    throw new Error(
      `The mini app kit at ${kit.dir} carries no theme tokens to check classes against.`,
    )
  }
  return tokens
}

/** One `file:line` problem per departure from the house style; empty when there is none. */
export async function checkMiniAppStyle(miniAppDir: string, kit: Kit): Promise<string[]> {
  const files = await scanSources({ root: miniAppDir, include: SOURCES, skip: isTest })
  const tokens = files.length > 0 ? await kitThemeTokens(kit) : null
  const problems: string[] = []
  for (const { file, code } of files) {
    for (const rule of [...kit.tools.style.rules, ...MINI_APP_STYLE_RULES]) {
      for (const match of code.matchAll(rule.pattern)) {
        problems.push(
          `${file}:${lineAt(code, match.index)} ${match[0]} — ${rule.name}: ${rule.fix}`,
        )
      }
    }
    // A misspelt token builds, type-checks and paints nothing.
    for (const hit of tokens ? kit.tools.style.missingTokens(code, tokens) : []) {
      problems.push(
        `${file}:${lineAt(code, hit.index)} ${hit.match} — absent token --${hit.kind}-${hit.token}: ${hit.fix}`,
      )
    }
  }
  if (problems.length <= MAX_REPORTED) return problems
  return [...problems.slice(0, MAX_REPORTED), `… and ${problems.length - MAX_REPORTED} more`]
}
