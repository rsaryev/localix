import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expandSkillContent } from '../../../chat/service/skill-commands'
import { runHookCommand } from '../../../lifecycle-hooks/command'
import { defaultSpawn } from '../../../plugins/monitor-stream'
import { resetShellConfigCache } from './shell'

/**
 * Every host-side command runner goes through the ONE shell resolver.
 *
 * Plugin monitors, lifecycle hooks and skill `!`cmd`` expansions each spawned a literal
 * `sh -c`, which does not exist on a stock Windows install — so all three failed there while
 * the agent's own commands, resolved to Git Bash, worked. The proof here is behavioural: the
 * resolver's override points at a wrapper that stamps its output, and each runner must show
 * the stamp. A runner that goes back to a literal `sh` loses it.
 */
const STAMP = 'via-resolved-shell:'
let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'shell-consumers-'))
  const wrapper = join(dir, 'bash')
  writeFileSync(wrapper, `#!/bin/sh\nprintf '%s' '${STAMP}'\nexec /bin/sh "$@"\n`)
  chmodSync(wrapper, 0o755)
  process.env.LOCALIX_SHELL = wrapper
  resetShellConfigCache()
})

afterAll(() => {
  delete process.env.LOCALIX_SHELL
  resetShellConfigCache()
  rmSync(dir, { recursive: true, force: true })
})

// The wrapper is a POSIX script; the Windows half of the contract is the resolver's own tests.
describe.skipIf(process.platform === 'win32')('host command runners use the resolved shell', () => {
  test('lifecycle hooks', async () => {
    const result = await runHookCommand({
      command: 'printf hook',
      input: '',
      cwd: dir,
      env: {},
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    })
    expect(result.stdout).toBe(`${STAMP}hook`)
  })

  test('skill command expansion', async () => {
    expect(await expandSkillContent('!`printf skill`', dir)).toBe(`${STAMP}skill`)
  })

  test('plugin monitors', async () => {
    const proc = defaultSpawn('printf monitor', { cwd: dir, env: process.env })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    expect(text).toBe(`${STAMP}monitor`)
  })
})
