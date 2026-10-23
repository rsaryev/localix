import { describe, expect, test } from 'bun:test'

import { fixesExecution, readPendingTurn, sameSurface } from './entry'
import { entry, event, person, report } from './testing/test-entries'

describe('what kind of entry an admission makes', () => {
  test('each producer shape is its own kind', () => {
    expect(person('p').value.entry).toBe('person')
    expect(report('r', 'agent:lead').value.entry).toBe('report')
    expect(event('e').value.entry).toBe('event')
    expect(entry('c', { command: {}, internal: false, source: 'user-busy' }).value.entry).toBe(
      'command',
    )
    // A webhook typed into a busy session is the person's channel, whatever its source says.
    expect(
      person('w', 'w', { internal: true, person: true, source: 'external' }).value,
    ).toMatchObject({ entry: 'person', internal: true, kind: 'wake' })
  })

  test('the client surface does not fix a run; authority, address and tools do', () => {
    const surface = { capabilities: ['workbench-ui'] }
    expect(fixesExecution(person('p', 'p', { toolSurface: surface }).value)).toBe(false)
    expect(fixesExecution(event('e', { extraDisabledTools: ['bash'] }).value)).toBe(true)
    expect(fixesExecution(event('e', { addressedAs: '' }).value)).toBe(true)
  })

  test('surfaces compare by capability and catalog, in any order', () => {
    const a = { capabilities: ['x', 'y'], catalogs: { x: '1' } }
    expect(sameSurface(a, { capabilities: ['y', 'x'], catalogs: { x: '1' } })).toBe(true)
    expect(sameSurface(a, { capabilities: ['x', 'y'], catalogs: { x: '2' } })).toBe(false)
    expect(sameSurface(undefined, undefined)).toBe(true)
    expect(sameSurface(a, undefined)).toBe(false)
  })
})

describe('a durable row written before entries were tagged', () => {
  const legacy = { userId: 'u', content: 'c', queuedAt: 't', internal: true, kind: 'wake' }

  test('is classified by the fields that made each kind', () => {
    expect(readPendingTurn({ ...legacy, agentTurn: { speakerAgentId: 'a' } }).entry).toBe('ticket')
    expect(readPendingTurn({ ...legacy, kind: 'user', internal: false, command: {} }).entry).toBe(
      'command',
    )
    expect(readPendingTurn({ ...legacy, kind: 'user', internal: false }).entry).toBe('person')
    expect(readPendingTurn({ ...legacy, source: 'user-busy' }).entry).toBe('person')
    // A legacy report has only its worded text: it is delivered as the plain wake it was.
    expect(readPendingTurn({ ...legacy, source: 'subagent' }).entry).toBe('event')
  })

  test('keeps the band its store recorded', () => {
    expect(readPendingTurn({ ...legacy, entry: 'event' }, 'q1').batch).toBe('q1')
    expect(readPendingTurn({ ...legacy }, 'q1').batch).toBe('q1')
    expect(readPendingTurn({ ...legacy, entry: 'event' }).batch).toBeUndefined()
  })
})
