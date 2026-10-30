import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { REVOCATION_FILE } from './revocation-file'
import { createMiniAppService } from './service'
import { INSTALL_RECORD_FILE } from './store-install'
import { MINI_APP_MANIFEST_DIR, MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

let home: string

beforeAll(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'mini-app-service-'))
  const root = join(home, '.localix', 'mini-apps', 'notes')
  await fs.mkdir(join(root, 'scripts'), { recursive: true })
  await fs.mkdir(join(root, MINI_APP_MANIFEST_DIR), { recursive: true })
  await fs.writeFile(
    join(root, MINI_APP_MANIFEST_FILE),
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
    await fs.mkdir(join(tiles, MINI_APP_MANIFEST_DIR), { recursive: true })
    await fs.writeFile(
      join(tiles, MINI_APP_MANIFEST_FILE),
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

  // A published app's folder names the repository it was published from; the Store's page of an
  // app made on this computer links there, as a marketplace's page links to its homepage.
  test('an app says where people read about it: its homepage, else the repository it names', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const write = async (name: string, manifest: Record<string, unknown>) => {
      const dir = join(home, '.localix', 'mini-apps', name)
      await fs.mkdir(dir, { recursive: true })
      await fs.mkdir(join(dir, MINI_APP_MANIFEST_DIR), { recursive: true })
      await fs.writeFile(
        join(dir, MINI_APP_MANIFEST_FILE),
        JSON.stringify({ name, version: '1.0.0', description: name, ...manifest }),
      )
    }
    await write('journal', { repository: 'git+https://github.com/you/journal.git' })
    await write('ledger', { repository: 'git@github.com:you/ledger.git' })
    await write('atlas', {
      homepage: 'https://atlas.example.test',
      repository: 'https://github.com/you/atlas',
    })
    await write('scratch', { repository: 'not a place' })
    const service = createMiniAppService({
      db,
      capabilityStores: {
        sources: createCapabilitySourceRepository,
        rules: createCapabilityRuleRepository,
      },
      homeDir: home,
    })
    const { miniApps } = await service.list('u1')
    const homepage = (name: string) => miniApps.find((app) => app.name === name)?.homepage
    expect(homepage('journal')).toBe('https://github.com/you/journal')
    expect(homepage('ledger')).toBe('https://github.com/you/ledger')
    expect(homepage('atlas')).toBe('https://atlas.example.test')
    expect(homepage('scratch')).toBeUndefined()
  })

  // Its marketplace took it back: the Store shows it as theirs and why it stopped, not as an app
  // the person made, and nothing runs it.
  test('an app a marketplace installed says which, and why it was taken back', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const dir = join(home, '.localix', 'mini-apps', 'radio')
    await fs.mkdir(join(dir, MINI_APP_MANIFEST_DIR), { recursive: true })
    await fs.writeFile(
      join(dir, MINI_APP_MANIFEST_FILE),
      JSON.stringify({ name: 'radio', version: '1.0.0', description: 'Radio' }),
    )
    await fs.writeFile(
      join(dir, INSTALL_RECORD_FILE),
      JSON.stringify({
        kind: 'localix-marketplace-install',
        marketplace: 'ada',
        url: 'https://ada.example.test/mini-app-marketplace.json',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        publisher: { name: 'Ada', verified: false },
      }),
    )
    await fs.writeFile(
      join(dir, REVOCATION_FILE),
      JSON.stringify({ marketplace: 'ada', version: '1.0.0', reason: 'It phones home.' }),
    )
    const service = createMiniAppService({
      db,
      capabilityStores: {
        sources: createCapabilitySourceRepository,
        rules: createCapabilityRuleRepository,
      },
      homeDir: home,
    })
    await service.setEnabled('u1', { name: 'radio', enabled: true })
    const radio = (await service.list('u1')).miniApps.find((app) => app.name === 'radio')
    expect(radio?.installedFrom).toEqual({
      marketplace: 'ada',
      publisher: { name: 'Ada', verified: false },
    })
    expect(radio?.revoked).toBe('It phones home.')
    expect(radio?.error).toBe('Its marketplace took it back: It phones home.')
  })
})
