import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoreActor } from '@localixai/store'

import { capabilityStores } from '../../bootstrap/capability-stores'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { InvalidRequestError } from '../../lib/domain-errors'
import { createAgentsService } from './service'
import type { AgentModelChoice } from '../agent-core/agent-model-route'
import { createAgentStoreProvider } from './store-provider'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

const actor: StoreActor = { userId: 'u' }
const inProject: StoreActor = { userId: 'u', projectId: 'p' }

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
  const projectClaude = join(root, 'project', '.claude')
  await mkdir(join(projectClaude, 'agents'), { recursive: true })
  const service = createAgentsService({
    db,
    capabilityStores,
    folders: async (_user, project) => ({
      managed,
      user: userClaude,
      project: project === 'p' ? [projectClaude] : [],
    }),
  })
  let heard = 0
  const choices: AgentModelChoice[] = []
  const provider = createAgentStoreProvider({
    agents: service,
    chatsOf: async () => 2,
    revisionOf: async (path) =>
      createHash('sha1')
        .update(await readFile(path, 'utf8'))
        .digest('hex'),
    choices: {
      read: async () => choices,
      write: async (_user, next) => void choices.splice(0, choices.length, ...next),
    },
    onChange: () => () => {
      heard++
    },
  })
  return {
    choices,
    provider,
    service,
    agentsDir: join(userClaude, 'agents'),
    managed,
    heard: () => heard,
  }
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
  expect(explore.bundled).toBe(true)
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
    { instructions: 'Be strict.', maxTurns: 5, skills: ['audit'] },
    actor,
  )
  const file = await readFile(path, 'utf8')
  expect(file).toContain('Be strict.')
  expect(file).toContain('hooks')
  expect(file).toContain('maxTurns: 5')
  const config = await provider.config!(ref.id, 'user', actor)
  expect(config?.values).toMatchObject({
    instructions: 'Be strict.',
    maxTurns: 5,
    skills: ['audit'],
  })
})

test('the model and effort saved from the page are the person’s choice, never written to the file', async () => {
  const { provider, agentsDir, choices } = await setup()
  const ref = await created(provider)
  await provider.setConfig!(ref.id, 'user', { model: 'openai/gpt-6', effort: 'high' }, actor)
  expect(choices).toEqual([{ agentId: ref.id, modelId: 'openai/gpt-6', effort: 'high' }])
  expect(await readFile(join(agentsDir, 'reviewer.md'), 'utf8')).not.toMatch(/^(model|effort):/m)
  expect((await provider.config!(ref.id, 'user', actor))?.values).toMatchObject({
    model: 'openai/gpt-6',
    effort: 'high',
  })
  // Clearing both removes the choice; deleting the agent leaves none behind.
  await provider.setConfig!(ref.id, 'user', { model: '', effort: '' }, actor)
  expect(choices).toEqual([])
  await provider.setConfig!(ref.id, 'user', { effort: 'low' }, actor)
  await provider.remove(ref.id, 'user', actor)
  expect(choices).toEqual([])
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

test('remove deletes the file', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  await provider.remove(ref.id, 'user', actor)
  await expect(readFile(join(agentsDir, 'reviewer.md'), 'utf8')).rejects.toThrow()
})

test('a save made over a file that changed meanwhile is refused, and the page says how many chats use it', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  const opened = await provider.config!(ref.id, 'user', actor)
  expect(opened?.revision).toBeTruthy()
  expect((await provider.detail(ref.id, actor)).facts).toContainEqual({
    label: 'Used by',
    value: '2 chats',
  })
  const path = join(agentsDir, 'reviewer.md')
  await writeFile(path, `${await readFile(path, 'utf8')}\nEdited elsewhere.\n`)
  await expect(
    provider.setConfig!(
      ref.id,
      'user',
      { instructions: 'Mine.', _revision: opened!.revision! },
      actor,
    ),
  ).rejects.toMatchObject({ code: 'agent_changed' })
  const fresh = await provider.config!(ref.id, 'user', actor)
  await provider.setConfig!(
    ref.id,
    'user',
    { instructions: 'Mine.', _revision: fresh!.revision! },
    actor,
  )
  expect(await readFile(path, 'utf8')).toContain('Mine.')
})

test('an agent moves between Yours and the open project, with its policy, and a name taken refuses it', async () => {
  const { provider, agentsDir } = await setup()
  const ref = await created(provider)
  await provider.setEnabled!(ref.id, 'user', false, actor)
  const moved = await provider.runAction!(ref.id, 'user', 'move', inProject)
  expect(moved.ok).toBe(true)
  await expect(readFile(join(agentsDir, 'reviewer.md'), 'utf8')).rejects.toThrow()
  const [there] = await provider.projectListings!({ ...inProject, projectId: 'p' })
  expect(there).toMatchObject({ name: 'reviewer', authored: 'project' })
  expect(there!.installs[0]!.enabled).toBe(false)
  // Back to Yours: the project's agent offers the opposite move.
  const config = await provider.config!(there!.ref.id, 'project', inProject)
  expect(config?.actions?.find((a) => a.id === 'move')?.label).toBe('Move to user')
  await created(provider)
  await expect(
    provider.runAction!(there!.ref.id, 'project', 'move', inProject),
  ).rejects.toMatchObject({
    code: 'agent_exists',
  })
})
