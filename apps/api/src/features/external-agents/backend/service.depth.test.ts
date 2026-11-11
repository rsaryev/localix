import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { AgentSessionsService } from './service'

/**
 * The History list and the statistics read the same index at two depths. A list is head and tail
 * of each transcript; the token-usage walk of every byte is what statistics need, and only they
 * wait for it. On a real history the walk was 10 GB and 12 s before the first row appeared.
 */
const dir = tempDirPerTest('ea-depth')
const SESSION = '00000000-0000-7000-8000-00000000000a'

function record(i: number): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `record-${i}`,
    timestamp: `2026-08-01T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
    message: {
      id: `request-${i}`,
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'x'.repeat(400) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  })
}

function fixture() {
  const home = join(dir(), 'home')
  const project = join(home, '.claude', 'projects', '-work-app')
  mkdirSync(project, { recursive: true })
  const opening = JSON.stringify({
    type: 'user',
    uuid: 'user-1',
    cwd: '/work/app',
    timestamp: '2026-08-01T10:00:00.000Z',
    message: { role: 'user', content: 'Fix the parser' },
  })
  // Longer than a head and a tail together, so a list read cannot see the middle.
  const body = Array.from({ length: 400 }, (_, i) => record(i))
  const file = join(project, `${SESSION}.jsonl`)
  writeFileSync(file, `${[opening, ...body].join('\n')}\n`)
  const service = new AgentSessionsService(join(dir(), 'state'), () => {}, {
    env: {},
    homeDir: home,
  })
  return { service, file }
}

describe('the History list does not wait for the usage walk', () => {
  test('a listed roster has every session and its title, and no walked counts yet', async () => {
    const { service } = fixture()
    const page = await service.roster({ cwdPrefix: '/work/app' }, undefined, 'listed')

    expect(page.items.map((row) => [row.title, row.cwd])).toEqual([['Fix the parser', '/work/app']])
    expect(page.items[0]?.messageCount).toBeUndefined()
  })

  test('statistics walk it once, and the list then carries what the walk counted', async () => {
    const { service } = fixture()
    await service.roster({}, undefined, 'listed')

    const stats = await service.stats({ days: 36500 })
    expect(stats.usage?.requests).toBe(400)

    const page = await service.roster({}, undefined, 'listed')
    expect(page.items[0]?.messageCount).toBe(401)
  })

  test('an append to a walked session is counted by the next list, without another walk', async () => {
    const { service, file } = fixture()
    await service.stats({ days: 36500 })
    appendFileSync(file, `${record(400)}\n`)
    // A fresh service over the same state: the coalescing window is per process, the index is not.
    const next = new AgentSessionsService(join(dir(), 'state'), () => {}, {
      env: {},
      homeDir: join(dir(), 'home'),
    })

    const page = await next.roster({}, undefined, 'listed')
    expect(page.items[0]?.messageCount).toBe(402)
  })

  test('a model filter needs the walk, so it waits for it even from a list', async () => {
    const { service } = fixture()
    const page = await service.roster({ model: 'claude-opus-4-8' }, undefined, 'listed')
    expect(page.total).toBe(1)
  })
})
