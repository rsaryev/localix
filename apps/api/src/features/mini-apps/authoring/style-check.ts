import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  missingTokens,
  themeTokensOf,
  type ThemeTokens,
} from '../../../contracts/ui-token-existence'
import { UI_TOKEN_RULES, type UiTokenRule } from '../../../contracts/ui-token-rules'
import { scanSources } from '../../../lib/source-lint'
import type { MiniAppKit } from './kit'
import { MINI_APP_KIT_STYLES_DIR } from './kit-layout'

/**
 * The house style, checked on a USER mini app the way the repository guard checks the app.
 *
 * A generated timer passed every build step with `<button className="rounded border px-4 py-2">`,
 * `text-red-500` and `bg-emerald-500`: it worked, and it looked like somebody else's app. The token
 * rules have bound the app and its bundled mini apps since the drift guard, but that guard reads
 * the repository, and a user's mini app lives in `~/.localix/mini-apps`. So the same list runs here
 * (`contracts/ui-token-rules.ts`, one owner), plus the rule only a mini app needs: a native form
 * control where the kit has one. The kit's controls carry the focus ring, the control heights and
 * the tokens; a hand-written one has to remember all three, and that timer's remembered none.
 */

export const MINI_APP_STYLE_RULES: readonly UiTokenRule[] = [
  {
    name: 'native control',
    // A file, range, colour or hidden input has no kit counterpart; everything else does.
    pattern:
      /<(?:button|select|textarea)(?=[\s>/])|<input(?=[\s>/])(?![^>]*\btype=["'](?:file|range|color|hidden)["'])/gu,
    fix: 'use the kit control — Button or IconButton (@localixai/kit/button, @localixai/kit/icon-button), Input, Select, Textarea, Switch, Checkbox',
    offender: 'const a = <button onClick={go}>Go</button>',
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
 * The tokens the host theme declares, read from the stylesheets staged in the kit — the same files
 * a mini app's utilities are compiled against, so a name that exists here is one the build emits.
 * A kit whose theme declares no colour is a broken install, not a mini app with no problems: every
 * kit-family class would read as absent, so it throws and the step reports an error instead.
 */
async function kitThemeTokens(kit: MiniAppKit): Promise<ThemeTokens> {
  const files = await cssFilesUnder(join(kit.dir, MINI_APP_KIT_STYLES_DIR))
  const tokens = themeTokensOf(
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
export async function checkMiniAppStyle(miniAppDir: string, kit: MiniAppKit): Promise<string[]> {
  // A mini app without a UI has nothing to check, which is not a disabled check.
  const files = await scanSources({ root: miniAppDir, include: SOURCES, skip: isTest, minFiles: 0 })
  const tokens = files.length > 0 ? await kitThemeTokens(kit) : null
  const problems: string[] = []
  for (const { file, code } of files) {
    for (const rule of [...UI_TOKEN_RULES, ...MINI_APP_STYLE_RULES]) {
      for (const match of code.matchAll(rule.pattern)) {
        const line = code.slice(0, match.index).split('\n').length
        problems.push(`${file}:${line} ${match[0]} — ${rule.name}: ${rule.fix}`)
      }
    }
    // A misspelt token builds, type-checks and paints nothing (`contracts/ui-token-existence.ts`).
    for (const hit of tokens ? missingTokens(code, tokens) : []) {
      const line = code.slice(0, hit.index).split('\n').length
      problems.push(
        `${file}:${line} ${hit.match} — absent token --${hit.kind}-${hit.token}: ${hit.fix}`,
      )
    }
  }
  if (problems.length <= MAX_REPORTED) return problems
  return [...problems.slice(0, MAX_REPORTED), `… and ${problems.length - MAX_REPORTED} more`]
}
