import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { dirname } from 'node:path'

import { assertPositiveControl, exemptionKey, scanSources } from '../../lib/source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * NO LAUNCH-DIRECTORY FALLBACK IN AGENT-CORE.
 *
 * `process.cwd()` is the API's launch directory: the monorepo checkout in development, the
 * install directory in a packaged build. Used as a default cwd it hands the host application to
 * the agent as its working directory — the defect `host-root-guard.ts` exists to stop, only
 * upstream of it. The neutral default is `localixWorkspaceDir()` (`lib/env.ts`), reached through
 * `resolveToolCwd`, so no agent-core module has a reason to read the launch directory at all.
 */

const CORE_DIR = dirname(Bun.fileURLToPath(import.meta.url))

async function launchCwdReads(root: string): Promise<string[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
  })
  return sources.flatMap((s) =>
    [...s.code.matchAll(/\bprocess\s*\.\s*cwd\s*\(/g)].map(() => exemptionKey(s.file, 'cwd()')),
  )
}

describe('agent-core never falls back to the launch directory', () => {
  test('no process.cwd() in agent-core production sources', async () => {
    const sources = await scanSources({
      root: CORE_DIR,
      include: ['**/*.ts'],
      skip: (f) => f.endsWith('.test.ts'),
      minFiles: 100,
    })
    expect(sources.length).toBeGreaterThan(100)
    expect(await launchCwdReads(CORE_DIR)).toEqual([])
  })

  test('positive control: a planted fallback is caught', async () => {
    await assertPositiveControl({
      subject: 'a process.cwd() fallback',
      file: 'tools/file/leaky.ts',
      offender: 'export const base = (cwd?: string) => cwd ?? process.cwd()\n',
      detect: launchCwdReads,
    })
  })
})
