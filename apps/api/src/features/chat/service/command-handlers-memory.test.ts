import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { sessionFixture } from '../../../testing/session-fixture'
import { handleMemoryControlCommand } from './command-handlers-listings'

/**
 * `/memory` works on the folder a run's own memory comes from: Claude Code's, on this machine. A
 * conversation on another machine or in a container has none, so `/memory` says so instead of
 * keeping a note no run would read.
 */
const scratch = tempDirPerTest('command-memory-')
let home: string
let previousHome: string | undefined

beforeEach(() => {
  home = scratch()
  previousHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
})

async function memory(executionBackend: 'local' | 'ssh' | 'docker', prompt: string) {
  const replies: string[] = []
  await handleMemoryControlCommand(
    { resolveSessionWorkingDir: async () => join(home, 'project') },
    'user-1',
    sessionFixture({ executionBackend }),
    prompt,
    (async (text: string) => void replies.push(text)) as never,
  )
  return replies[0]!
}

describe('/memory', () => {
  test('saves a fact for a conversation on this machine', async () => {
    expect(await memory('local', '/memory prefer Bun')).toContain('Saved to')
    expect(existsSync(join(home, '.claude', 'projects'))).toBe(true)
  })

  test.each(['ssh', 'docker'] as const)(
    'says it has none on a %s conversation',
    async (backend) => {
      const reply = await memory(backend, '/memory prefer Bun')
      expect(reply).toContain('no auto memory folder')
      expect(readdirSync(home)).not.toContain('.claude')
      expect(await memory(backend, '/memory')).toContain('no auto memory folder')
    },
  )
})
