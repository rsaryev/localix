import { afterEach, describe, expect, it } from 'bun:test'

import { createConditions, headline, problemFingerprint, subjectPrefix } from './condition'
import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from './testing/test-journal'
import { recoveryAction } from '../recovery'

const journals: TestJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  return { test, conditions: createConditions(test.journal) }
}

const down = (problem: string) => ({
  subject: ['mcp', 'github', ''],
  problem,
  severity: 'error' as const,
  title: 'Could not connect to the MCP server “github”',
  body: problem,
  origin: { kind: 'application' as const, label: 'github' },
  actions: [recoveryAction('open-store:mcp-server/github')] as const,
})

describe('a standing condition', () => {
  it('is one row however often the same problem is republished', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, down('ECONNREFUSED'))
    conditions.raise(U, down('ECONNREFUSED'))
    await test.journal.flush()
    // A fresh process (no memo) republishing it is still a no-op: the journal's idempotency.
    createConditions(test.journal).raise(U, down('ECONNREFUSED'))
    const rows = await test.rows()
    expect(rows.size).toBe(1)
    expect([...rows.values()][0]).toMatchObject({ condition: true, occurrenceCount: 1 })
  })

  it('replaces a changed problem of the same subject instead of stacking it', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, down('ECONNREFUSED'))
    conditions.raise(U, down('401 Unauthorized'))
    const open = await openRows(test)
    expect(open.map((row) => row.body)).toEqual(['401 Unauthorized'])
    const settled = [...(await test.rows()).values()].find((row) => row.state === 'settled')
    expect(settled?.settleReason).toBe('superseded')
  })

  it('settles when the subject works again, and reopens with a count when it breaks again', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, down('ECONNREFUSED'))
    conditions.clear(U, ['mcp', 'github', ''])
    await test.journal.flush()
    expect(await openRows(test)).toEqual([])
    conditions.raise(U, down('ECONNREFUSED'))
    const [row] = await openRows(test)
    expect(row).toMatchObject({ state: 'open', occurrenceCount: 2 })
  })

  it('never lets one subject settle another that shares its leading characters', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'ab'] })
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'a:b'] })
    conditions.clear(U, ['plugin', 'a'])
    expect((await openRows(test)).length).toBe(2)
    expect(subjectPrefix(['plugin', 'a:b'])).toBe('condition:plugin:a%3Ab:')
  })

  it('clearing a parent subject settles its children, and a child raised after is not swallowed', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'p', 'load', ''] })
    conditions.clear(U, ['plugin', 'p'])
    expect(await openRows(test)).toEqual([])
    conditions.raise(U, { ...down('y'), subject: ['plugin', 'p', 'monitor', 'm'] })
    // The parent was remembered as clear; the child made that untrue, so this clear must go out.
    conditions.clear(U, ['plugin', 'p'])
    expect(await openRows(test)).toEqual([])
  })

  it('sweeps rows about subjects that are gone, keeping the rest', async () => {
    const { test, conditions } = await setup()
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'kept', 'load', ''] })
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'gone', 'load', ''] })
    await conditions.sweep(U, ['plugin'], ([name]) => name === 'kept')
    const rows = await test.rows()
    const states = [...rows.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => [row.key.split(':')[2], row.state, row.settleReason])
    expect(states).toEqual([
      ['gone', 'settled', 'cancelled'],
      ['kept', 'open', undefined],
    ])
    // Swept, then raised again: it came back, so it reopens rather than being remembered away.
    conditions.raise(U, { ...down('x'), subject: ['plugin', 'gone', 'load', ''] })
    expect((await openRows(test)).length).toBe(2)
  })
})

describe('a problem’s identity and headline', () => {
  it('folds long digit runs so a port or a timeout does not mint a new row per attempt', () => {
    expect(problemFingerprint('timed out after 30000ms on :51234')).toBe(
      problemFingerprint('timed out after 45000ms on :60001'),
    )
    expect(problemFingerprint('HTTP 401')).not.toBe(problemFingerprint('HTTP 500'))
  })

  it('makes a headline of a sentence', () => {
    expect(headline('the webhook endpoint rejected the delivery.')).toBe(
      'The webhook endpoint rejected the delivery',
    )
    expect(headline(`first line\nsecond`)).toBe('First line')
    expect(headline('x'.repeat(200)).length).toBe(120)
  })
})
