import { describe, expect, test } from 'bun:test'
import { agentRecordSchema } from './contracts'
import { builtinAgentRecord } from './builtin'
import { agentPolicy, canEditField, FIELD_KEYS, lockedChanges } from './policy'

describe('agent definition ownership', () => {
  test('every native field has exactly one editing owner', () => {
    const keys: string[] = Object.values(FIELD_KEYS).flat()
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(Object.keys(agentRecordSchema.shape).sort())
  })
  test('a builtin permits behavior edits but never identity edits', () => {
    const record = builtinAgentRecord('lead')!
    const policy = agentPolicy({ record, builtin: true })
    expect(canEditField(policy, 'prompt')).toBe(true)
    expect(lockedChanges(policy, record, { ...record, instructions: 'Edited' })).toEqual([])
    expect(lockedChanges(policy, record, { ...record, id: 'other' })).toEqual(['id'])
    expect(lockedChanges(policy, record, { ...record, handle: 'other' })).toEqual(['name'])
    expect(policy.delete).toBe(false)
  })
  test('a same-named project agent has independent ownership', () => {
    const record = { ...builtinAgentRecord('localix')!, id: 'project-localix' }
    expect(agentPolicy({ record, builtin: false })).toMatchObject({ disable: true, delete: true })
    expect(agentPolicy({ record: builtinAgentRecord('localix')!, builtin: true }).disable).toBe(
      false,
    )
  })
})
