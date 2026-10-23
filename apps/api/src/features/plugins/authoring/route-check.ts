import { RAW_BODY_PARSE, RAW_BODY_PARSE_FIX } from '../../../contracts/route-body-rule'
import { scanSources } from '../../../lib/source-lint'

/**
 * A USER plugin's routes read their bodies the one safe way.
 *
 * The repository guard keeps every route in this repo off `c.req.json()`, which parses a body
 * under any content type and so lets a page on any origin POST to it with no preflight. A user
 * plugin lives in `~/.localix/plugins`, outside that guard — and the reference its copies start
 * from shipped exactly that call in its `POST /marks`, so every copy made from it did too. The
 * rule is the repository's own (`contracts/route-body-rule.ts`), run here on the backend.
 */

const SOURCES = ['backend/**/*.ts', 'shared/**/*.ts']
const isTest = (file: string) => file.endsWith('.test.ts')

/** One `file:line` problem per raw body parse; empty when every route validates its body. */
export async function checkMiniAppRoutes(pluginDir: string): Promise<string[]> {
  const files = await scanSources({ root: pluginDir, include: SOURCES, skip: isTest, minFiles: 0 })
  const problems: string[] = []
  for (const { file, code } of files) {
    for (const match of code.matchAll(RAW_BODY_PARSE)) {
      const line = code.slice(0, match.index).split('\n').length
      problems.push(`${file}:${line} ${match[0]} — unvalidated body: ${RAW_BODY_PARSE_FIX}`)
    }
  }
  return problems
}
