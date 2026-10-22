/**
 * The session's env scripts (Claude Code's `CLAUDE_ENV_FILE`) run before each bash command, in
 * its shell, so what a SessionStart hook exported reaches the command; a missing file is skipped.
 */
import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import { withEnvScripts } from './bash-run-context'

const dir = tempDirPerTest('bash-env-scripts-')

describe('withEnvScripts', () => {
  it('sources each existing script before the command', async () => {
    const first = join(dir(), "it's.sh")
    writeFileSync(first, 'export CCX_PROBE=from-env-file\n')
    const ctx = { env: localEnvironment, envScripts: [first, join(dir(), 'missing.sh')] }
    const result = await localEnvironment.exec(withEnvScripts(ctx, 'echo "probe=$CCX_PROBE"'), {
      cwd: dir(),
    })
    expect(result.stdout.trim()).toBe('probe=from-env-file')
    expect(result.exitCode).toBe(0)
  })

  it('leaves the command alone without scripts or off the local backend', () => {
    expect(withEnvScripts({ env: localEnvironment }, 'ls')).toBe('ls')
    const remote = { config: { kind: 'ssh' } } as unknown as ExecutionEnvironment
    expect(withEnvScripts({ env: remote, envScripts: ['/x.sh'] }, 'ls')).toBe('ls')
  })
})
