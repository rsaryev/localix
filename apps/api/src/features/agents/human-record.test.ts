import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUMAN_AGENT_ID } from '@localixai/agent/agents'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAgentsService } from './service'
import { agentRecordInputSchema, agentRecordSchema } from './contracts'
import { createInvocationRegistry } from '../capabilities/invocation'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-human-record-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const globalDir = join(root, 'agents')
  const projectCwd = join(root, 'project')
  await mkdir(globalDir)
  await mkdir(projectCwd)
  const service = createAgentsService({
    db,
    invocations: createInvocationRegistry(),
    globalDir,
    resolveProjectCwd: async (_user, project) => (project === 'p' ? projectCwd : null),
  })
  return { service, globalDir, projectCwd }
}

const human = (fields: { label?: string; description?: string; instructions?: string }) =>
  agentRecordInputSchema.parse({
    kind: 'human',
    handle: 'human',
    description: '',
    instructions: '',
    ...fields,
  })

describe('the human record', () => {
  test('ships beside Localix and is never listed, invoked or selected as an agent', async () => {
    const { service } = await fixture()
    expect(await service.getHuman('u')).toMatchObject({ id: HUMAN_AGENT_ID, kind: 'human' })
    for (const projectId of [null, 'p']) {
      const listed = await service.listAgents('u', { projectId })
      expect(listed.map((agent) => agent.record.handle)).toEqual(['localix'])
      const invocable = await service.listInvocableAgents('u', 'chat', { projectId })
      expect(invocable.map((agent) => agent.record.kind)).not.toContain('human')
      expect(await service.selectEnabledAgent('u', 'human', projectId)).toBeNull()
      expect(await service.resolveEnabledAgent('u', HUMAN_AGENT_ID, projectId)).toBeNull()
    }
    const run = await service.resolveRunAgent('u', HUMAN_AGENT_ID, 'chat')
    expect(run.status).not.toBe('allowed')
  })

  test('resolves project → installation → shipped, and Restore steps back one level', async () => {
    const { service, globalDir, projectCwd } = await fixture()
    await service.updateAgent('u', 'human', human({ description: 'Manual QA' }))
    expect(existsSync(join(globalDir, 'human.json'))).toBe(true)
    expect((await service.getHuman('u', 'p')).description).toBe('Manual QA')

    await service.updateAgent('u', 'human', human({ label: 'Rus', description: 'Owner' }), 'p')
    const projectFile = join(projectCwd, '.localix', 'agents', 'human.json')
    expect(JSON.parse(await readFile(projectFile, 'utf8')).description).toBe('Owner')
    expect(await service.getHuman('u', 'p')).toMatchObject({ label: 'Rus', description: 'Owner' })
    expect((await service.getHuman('u')).description).toBe('Manual QA')

    await service.resetAgent('u', 'human', 'p')
    expect((await service.getHuman('u', 'p')).description).toBe('Manual QA')
    await service.resetAgent('u', 'human')
    expect((await service.getHuman('u', 'p')).description).toBe('')
  })

  test('only label, description and instructions can change; it cannot be deleted or disabled', async () => {
    const { service } = await fixture()
    const withRunSettings = { ...human({}), modelPreference: { model: 'm' } }
    expect(agentRecordInputSchema.safeParse(withRunSettings).success).toBe(false)
    expect(agentRecordInputSchema.safeParse({ ...human({}), leadershipPriority: 2 }).success).toBe(
      false,
    )
    expect(service.deleteAgent('u', 'human')).rejects.toThrow()
    expect(service.setAgentEnabled('u', 'human', false)).rejects.toThrow()
    expect(service.duplicateAgent('u', 'human', 'copy')).rejects.toThrow()
  })

  test('description and instructions together are capped at 1000 characters', () => {
    const at = human({ description: 'd'.repeat(400), instructions: 'i'.repeat(600) })
    expect(agentRecordSchema.safeParse({ ...at, id: HUMAN_AGENT_ID }).success).toBe(true)
    expect(agentRecordInputSchema.safeParse({ ...at, instructions: 'i'.repeat(601) }).success).toBe(
      false,
    )
  })

  test('no other record may claim the person', () => {
    expect(
      agentRecordInputSchema.safeParse({ handle: 'human', description: '', instructions: 'x' })
        .success,
    ).toBe(false)
    expect(agentRecordInputSchema.safeParse({ ...human({}), handle: 'someone' }).success).toBe(
      false,
    )
  })
})
