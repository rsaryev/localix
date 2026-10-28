import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { agentPolicy, canEditField } from './policy'

const record = (id: string) => ({ id, name: 'x', description: '', instructions: 'x' }) as never

describe('agent policy', () => {
  test('a file the person owns is edited, deleted and copied; the rest is copied only', () => {
    const own = agentPolicy({ record: record('cc:1'), editable: true })
    expect(canEditField(own, 'name')).toBe(true)
    expect(own).toMatchObject({ delete: true, duplicate: true, disable: true })
    const shipped = agentPolicy({ record: record('builtin:Explore'), editable: false })
    expect(shipped.editable).toEqual([])
    expect(shipped).toMatchObject({ delete: false, duplicate: true })
  })

  test('the main loop cannot be switched off', () => {
    expect(agentPolicy({ record: record(DEFAULT_AGENT_ID), editable: false }).disable).toBe(false)
  })
})
