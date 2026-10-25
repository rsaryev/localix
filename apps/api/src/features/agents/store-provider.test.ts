import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoreActor } from '@localixai/store'

import { capabilityStores } from '../../bootstrap/capability-stores'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { InvalidRequestError } from '../../lib/domain-errors'
import { createAgentsService } from './service'
import { createAgentStoreProvider } from './store-provider'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

const actor: StoreActor = { userId: 'u' }

/** The provider over the real agents service and files in a temp `~/.claude`. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'localix-agent-store-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const userClaude = join(root, 'home', '.claude')
  const managed = join(root, 'managed', '.claude')
  await mkdir(join(userClaude, 'agents'), { recursive: true })
  await mkdir(join(managed, 'agents'), { recursive: true })
  const service = createAgentsService({
    db,
    capabilityStores,
    folders: async () => ({ managed, user: userClaude, project: [] }),
  })
  let heard = 0
  const provider = createAgentStoreProvider({
    agents: service,
    onChange: () => () => {
      heard++
    },
  })
  return { provider, service, agentsDir: join(userClaude, 'agents'), managed, heard: () => heard }
}

const created = async (provider: Awaited<ReturnType<typeof setup>>['provider']) =>
  provider.create!('user', { name: 'reviewer', description: 'Reviews code' }, actor)

test('New agent writes the file, and the listing shows it under Yours, editable', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  expect(await readFile(join(agentsDir, 'reviewer.md'), 'utf8')).toContain('Reviews code')
  const { listings } = await provider.listings(actor)
  const mine = listings.find((listing) => listing.ref.id === ref.id)!
  expect(mine).toMatchObject({ authored: 'user', configurable: true, name: 'reviewer' })
  expect(mine.installs).toEqual([{ scope: 'user', enabled: true }])
})

test('the shipped types are listed read-only, and cannot be removed or edited', async () => {
  const { provider } = await setup()
  const { listings } = await provider.listings(actor)
  const explore = listings.find((listing) => listing.name === 'Explore')!
  expect(explore.authored).toBeUndefined()
  expect((await provider.config!(explore.ref.id, 'user', actor))?.fields).toEqual([])
  await expect(provider.remove(explore.ref.id, 'user', actor)).rejects.toBeInstanceOf(
    InvalidRequestError,
  )
  await expect(provider.setConfig!(explore.ref.id, 'user', { name: 'x' }, actor)).rejects.toThrow(
    'Copy it to Yours',
  )
})

test('a Definition saved from the page lands in the file, keeping what the form does not model', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  const path = join(agentsDir, 'reviewer.md')
  await writeFile(path, (await readFile(path, 'utf8')).replace('---\n', '---\nhooks: {}\n'))
  await provider.setConfig!(
    ref.id,
    'user',
    { instructions: 'Be strict.', model: 'openai/gpt-6', maxTurns: 5, skills: ['audit'] },
    actor,
  )
  const file = await readFile(path, 'utf8')
  expect(file).toContain('Be strict.')
  expect(file).toContain('hooks')
  expect(file).toContain('maxTurns: 5')
  const config = await provider.config!(ref.id, 'user', actor)
  expect(config?.values).toMatchObject({
    instructions: 'Be strict.',
    model: 'openai/gpt-6',
    maxTurns: 5,
    skills: ['audit'],
  })
})

test('a rename keeps the page: the id is the same', async () => {
  const { provider } = await setup()
  const ref = await created(provider)
  await provider.setConfig!(ref.id, 'user', { name: 'auditor' }, actor)
  expect((await provider.detail(ref.id, actor)).name).toBe('auditor')
})

test('the switch writes a rule, and a copy of a read-only agent is an editable file of Yours', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  await provider.setEnabled!(ref.id, 'user', false, actor)
  expect((await provider.detail(ref.id, actor)).installs[0]!.enabled).toBe(false)
  const { listings } = await provider.listings(actor)
  const explore = listings.find((listing) => listing.name === 'Explore')!
  const result = await provider.runAction!(explore.ref.id, 'user', 'copy', actor)
  expect(result.ok).toBe(true)
  expect(await readFile(join(agentsDir, 'Explore-copy.md'), 'utf8')).toContain('name')
})

test('remove deletes the file; install, update and plan do not exist for an agent', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  await provider.remove(ref.id, 'user', actor)
  await expect(readFile(join(agentsDir, 'reviewer.md'), 'utf8')).rejects.toThrow()
  await expect(provider.install(ref.id, 'user', { plan: true }, actor)).rejects.toBeInstanceOf(
    InvalidRequestError,
  )
})
