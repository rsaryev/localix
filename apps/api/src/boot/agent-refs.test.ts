import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { findPluginAgent, parsePluginAgentRef, toDelegateRole } from './agent-refs'
import type { Kysely } from 'kysely'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { createAvailabilityWriter } from '../features/capabilities/availability'
import { createDatabase } from '../db/connection'
import { migrateToLatest } from '../db/migrator'
import type { AppDatabase } from '../db/types'

/** Real plugin discovery and availability scopes for the remaining delegate adapter. */

const tempDir = join(process.cwd(), 'tmp', 'agent-refs-tests')
const USER = 'u1'
const PROJECT = 'proj-1'
const PLUGIN = 'localix-scope-probe'

/**
 * Availability is a rule on an AGENT, not a column on the plugin's state row.
 *
 * Which project a plugin belongs to still decides whether discovery finds it — that is where
 * it is installed. Whether it may run is the agent's rules, and a lookup outside a turn asks
 * the agent that always exists.
 */
const setPlugin = (db: Kysely<AppDatabase>, _projectId: string, enabled: boolean) =>
  createAvailabilityWriter(db).set(USER, DEFAULT_AGENT_ID, 'plugin', [{ name: PLUGIN, enabled }])
const enablePlugin = (db: Kysely<AppDatabase>, projectId: string) => setPlugin(db, projectId, true)
const disablePlugin = (db: Kysely<AppDatabase>, projectId: string) =>
  setPlugin(db, projectId, false)

async function freshDb(): Promise<Kysely<AppDatabase>> {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return db
}

/** A project working dir containing a project-scoped plugin that declares one agent. */
async function projectWithPlugin(): Promise<string> {
  const cwd = join(tempDir, randomUUID())
  const dir = join(cwd, '.localix/plugins', PLUGIN)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      description: 'project-scoped plugin under test',
      agents: [
        { name: 'auditor', description: 'audits', prompt: 'You audit.', preferredModel: 'sonnet' },
      ],
    }),
  )
  return cwd
}

function resolver(db: Kysely<AppDatabase>, cwdByProject: Record<string, string>) {
  return (name: string, projectId: string | null) =>
    findPluginAgent({ db, userId: USER }, parsePluginAgentRef(name)!, {
      projectId,
      cwd: projectId ? (cwdByProject[projectId] ?? null) : null,
    })
}

describe('delegate plugin lookup preserves project discovery and availability scopes', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("a lookup resolves that project's enabled plugin agent", async () => {
    const db = await freshDb()
    const cwd = await projectWithPlugin()
    // The user enabled it — at project scope, which is how the Settings UI stores it:
    // a rule, not a column, because a column has nowhere to say "off for THIS agent".
    await enablePlugin(db, PROJECT)

    const role = await resolver(db, { [PROJECT]: cwd })(`${PLUGIN}:auditor`, PROJECT)

    expect(role).not.toBeNull()
    expect(role?.name).toBe('auditor')
    expect(role?.prompt).toBe('You audit.')
    expect(role?.preferredModel).toBe('sonnet') // the role really arrives, not a husk
    await db.destroy()
  })

  test('a DISABLED project plugin still resolves to nothing — scope is not a trust bypass', async () => {
    const db = await freshDb()
    const cwd = await projectWithPlugin()
    await disablePlugin(db, PROJECT)

    expect(await resolver(db, { [PROJECT]: cwd })(`${PLUGIN}:auditor`, PROJECT)).toBeNull()
    await db.destroy()
  })

  test('the same plugin is invisible to a lookup on ANOTHER project', async () => {
    const db = await freshDb()
    const cwd = await projectWithPlugin()
    await enablePlugin(db, PROJECT)

    // 'proj-2' has its own working dir, which holds no plugins.
    const otherCwd = join(tempDir, randomUUID())
    await mkdir(otherCwd, { recursive: true })

    expect(
      await resolver(db, { [PROJECT]: cwd, 'proj-2': otherCwd })(`${PLUGIN}:auditor`, 'proj-2'),
    ).toBeNull()
    await db.destroy()
  })

  test('a lookup with NO project keeps the global-only lookup', async () => {
    const db = await freshDb()
    const cwd = await projectWithPlugin()
    await enablePlugin(db, PROJECT)

    // An absent project searches only global sources.
    expect(await resolver(db, { [PROJECT]: cwd })(`${PLUGIN}:auditor`, null)).toBeNull()
    await db.destroy()
  })
})

describe('toDelegateRole carries every field a delegate child runs under', () => {
  test('a declared effort survives the projection', () => {
    // The field list here is the seam a role field goes missing at. Its own header records that
    // the two resolver branches used to spell the list out separately, "so a new role field
    // could reach the registry branch and silently miss the plugin one" — and `preferredEffort`
    // was exactly that: parsed from frontmatter, validated by two validators, stored on the
    // loaded record, and then dropped here. `preferredModel`, one line above it, was carried.
    const role = toDelegateRole({
      prompt: 'be careful',
      preferredModel: 'sonnet',
      preferredEffort: 'high',
    })
    expect(role.preferredEffort).toBe('high')
    expect(role.preferredModel).toBe('sonnet')
  })

  test('an absent effort stays absent rather than becoming a level', () => {
    expect(toDelegateRole({ prompt: 'p' }).preferredEffort).toBeUndefined()
  })
})
