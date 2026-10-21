import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAvailabilityWriter } from './availability'
import {
  __resetCapabilityRevision,
  capabilitiesChanged,
  capabilityRevision,
  trackCapabilityChange,
} from './revision'
import { createCapabilityRuleRepository } from './rule-repository'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  __resetCapabilityRevision(0)
  return db
}

describe('capability rule changes', () => {
  test('a rule write is announced by its key in its own transaction, and bumps once', async () => {
    const db = await setup()
    await createCapabilityRuleRepository(db).replace('u1', 'a1', [
      { action: 'plugin:x', resource: '*', effect: 'allow' },
    ])
    expect(capabilityRevision()).toBe(1)
    const rows = await db.selectFrom('change_events').select(['entity', 'op', 'ref_json']).execute()
    expect(rows).toEqual([
      {
        entity: 'capability.rule',
        op: 'upserted',
        ref_json: JSON.stringify({ userId: 'u1', agentId: 'a1' }),
      },
    ])
  })

  test('enabling an agent moves the revision once', async () => {
    const db = await setup()
    const writer = createAvailabilityWriter(db)
    // What the observed `setAgentEnabled` is: a rule write, then "capabilities changed".
    await trackCapabilityChange(async () => {
      await writer.set('u1', 'a1', 'agent', [{ name: 'a2', enabled: true }])
      capabilitiesChanged()
    })
    expect(capabilityRevision()).toBe(1)
  })

  test('a mutation that wrote no rule still announces; a concurrent bump does not stand in', async () => {
    await setup()
    let release!: () => void
    const pending = trackCapabilityChange(async () => {
      await new Promise<void>((resolve) => (release = resolve))
      capabilitiesChanged()
    })
    // Another mutation bumps meanwhile, outside this one.
    await trackCapabilityChange(async () => capabilitiesChanged())
    release()
    await pending
    expect(capabilityRevision()).toBe(2)
  })
})
