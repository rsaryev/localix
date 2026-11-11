import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatPluginSessions, invokeTypedSkills } from '../../../plugins/kit'
import { diskPluginHost } from '../../../plugins/kit/testing'
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
    const work = join(dir, 'work')
    mkdirSync(join(work, '.claude', 'skills', 'stamp'), { recursive: true })
    writeFileSync(join(work, '.claude', 'skills', 'stamp', 'SKILL.md'), '!`printf skill`\n')
    const session = createChatPluginSessions(diskPluginHost(join(dir, 'home'))).forRun({
      chatId: 'chat-1',
      cwd: work,
      transcriptPath: join(dir, 'home', 'chat-1.jsonl'),
      permissionMode: 'default',
      trusted: true,
      layers: [],
      plugins: [],
    })
    const typed = await invokeTypedSkills(session, '/stamp', {
      shellPermission: () => 'allow',
      signal: AbortSignal.timeout(10_000),
    })
    expect(typed.ok ? typed.skills[0]?.text : typed.message).toEndWith(`\n${STAMP}skill\n`)
  })

  test('plugin monitors', async () => {
    const proc = defaultSpawn('printf monitor', { cwd: dir, env: process.env })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    expect(text).toBe(`${STAMP}monitor`)
  })
})
