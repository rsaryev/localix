import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { sessionFixture } from '../../../../testing/session-fixture'
import { createChatRepository } from '../../repository'
import { pluginAgentModelFor } from './plugin-main-agent-model'

const CATALOG = ['openai/gpt-4o', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-3-5-sonnet']

describe('the model a plugin main agent asks for', () => {
  test('applies over a seat the person did not pick, alias resolved to the newest match', () => {
    expect(
      pluginAgentModelFor({
        declared: 'sonnet',
        seatModelId: 'openai/gpt-4o',
        seatChosen: false,
        catalogModelIds: CATALOG,
      }),
    ).toBe('anthropic/claude-sonnet-4-5')
  })

  test('the person’s own pick, `inherit`, no model or the same model change nothing', () => {
    const seat = { seatModelId: 'openai/gpt-4o', catalogModelIds: CATALOG }
    expect(pluginAgentModelFor({ ...seat, declared: 'sonnet', seatChosen: true })).toBeNull()
    expect(pluginAgentModelFor({ ...seat, declared: 'inherit', seatChosen: false })).toBeNull()
    expect(pluginAgentModelFor({ ...seat, declared: undefined, seatChosen: false })).toBeNull()
    expect(
      pluginAgentModelFor({ ...seat, declared: 'openai/gpt-4o', seatChosen: false }),
    ).toBeNull()
  })
})

describe('whether a seat’s model is the person’s pick', () => {
  const dir = tempDirPerTest('seat-choice-')

  test('a seat born on a default is not; one the person re-routed is', async () => {
    const db = createDatabase({ filename: join(dir(), `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    try {
      const repo = createChatRepository(db)
      const seat = {
        agentId: 'a',
        handle: 'a',
        providerConnectionId: null,
        modelId: 'openai/gpt-4o',
        reasoningEffort: 'medium' as const,
      }
      await repo.insertSession(
        sessionFixture({ id: 's1', userId: 'u', agents: [{ ...seat, modelOrigin: 'agent' }] }),
      )
      expect(await repo.isSeatModelChosen('u', 's1', 'a')).toBe(false)
      await repo.updateSessionAgentRoute('u', 's1', 'a', { modelId: 'x/y' }, { seeded: true })
      expect(await repo.isSeatModelChosen('u', 's1', 'a')).toBe(false)
      await repo.updateSessionAgentRoute('u', 's1', 'a', { modelId: 'openai/gpt-4o' })
      expect(await repo.isSeatModelChosen('u', 's1', 'a')).toBe(true)
      expect(await repo.isSeatModelChosen('someone-else', 's1', 'a')).toBe(false)
    } finally {
      await destroyDatabase(db)
    }
  })
})
