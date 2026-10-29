import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createMiniAppService } from './service'

let home: string

beforeAll(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'mini-app-service-'))
  const root = join(home, '.localix', 'mini-apps', 'notes')
  await fs.mkdir(join(root, 'scripts'), { recursive: true })
  await fs.writeFile(
    join(root, 'mini-app.json'),
    JSON.stringify({
      name: 'notes',
      version: '1.0.0',
      description: 'Notes',
      commands: {
        open: {
          description: 'Open a note',
          prompt: 'Open ${note}',
          args: [{ name: 'note', type: 'choice', optionsScript: './scripts/notes.ts' }],
        },
      },
    }),
  )
})

afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

describe('the mini app service', () => {
  test('a command offered to the composer says its options load on demand, never where from', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const service = createMiniAppService({
      db,
      capabilityStores: {
        sources: createCapabilitySourceRepository,
        rules: createCapabilityRuleRepository,
      },
      homeDir: home,
    })
    await service.setEnabled('u1', { name: 'notes', enabled: true })
    const { commands } = await service.contributions('u1')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ app: 'notes', fullName: 'notes:open' })
    expect(commands[0]!.args[0]).toMatchObject({ name: 'note', dynamic: true })
    expect(JSON.stringify(commands)).not.toContain('scripts/notes.ts')
  })

  test('an installed app is removed, and no later discovery brings it back', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const tiles = join(home, '.localix', 'mini-apps', 'tiles')
    await fs.mkdir(tiles, { recursive: true })
    await fs.writeFile(
      join(tiles, 'mini-app.json'),
      JSON.stringify({ name: 'tiles', version: '1.0.0', description: 'Tiles' }),
    )
    const service = createMiniAppService({
      db,
      capabilityStores: {
        sources: createCapabilitySourceRepository,
        rules: createCapabilityRuleRepository,
      },
      homeDir: home,
    })
    await service.remove('u1', { name: 'tiles' })
    const { miniApps } = await service.list('u1')
    expect(miniApps.map((app) => app.name)).not.toContain('tiles')
    // Set aside, not deleted: its backend may be the module this process still runs.
    const left = await fs.readdir(join(home, '.localix', 'mini-apps'))
    expect(left.some((name) => name.startsWith('.sync-retired-tiles-'))).toBe(true)
  })
})
