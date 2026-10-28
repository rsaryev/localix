import type { Kit } from '../kit/kit'
import { lineAt, scanSources } from '../lib/scan'

/**
 * A mini app's routes read their bodies the one safe way. `c.req.json()` parses a body under any
 * content type, so a page on any origin can POST to it with no preflight. The rule is Localix's
 * (`tools.routes` in the kit), run here on the backend.
 */

const SOURCES = ['backend/**/*.ts', 'shared/**/*.ts']
const isTest = (file: string) => file.endsWith('.test.ts')

/** One `file:line` problem per raw body parse; empty when every route validates its body. */
export async function checkMiniAppRoutes(miniAppDir: string, kit: Kit): Promise<string[]> {
  const { rawBodyParse, rawBodyParseFix } = kit.tools.routes
  const files = await scanSources({ root: miniAppDir, include: SOURCES, skip: isTest })
  const problems: string[] = []
  for (const { file, code } of files) {
    for (const match of code.matchAll(new RegExp(rawBodyParse.source, 'gu'))) {
      problems.push(
        `${file}:${lineAt(code, match.index)} ${match[0]} — unvalidated body: ${rawBodyParseFix}`,
      )
    }
  }
  return problems
}
