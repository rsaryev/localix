import { afterEach, describe, expect, test } from 'bun:test'

import {
  __resetExpectedReports,
  awaitsReports,
  dropExpectedReport,
  expectReport,
  onReportSettled,
  settleReport,
  takeExpectedReport,
} from '../../../agent-core/delegation-awaits'
import { heldEntries, MAX_REPORT_HOLD_MS } from './holds'
import { event, QUEUED_AT, report } from './testing/test-entries'

afterEach(() => __resetExpectedReports())

const barrier = { awaits: awaitsReports, subscribe: onReportSettled }
const lead = { sessionId: 'entries' }
const at = Date.parse(QUEUED_AT)

describe('a report waits for its siblings', () => {
  test('held while another child of its delegator is still owed, released once it settles', () => {
    expectReport('a', lead)
    expectReport('b', lead)
    takeExpectedReport('a')
    settleReport('a')
    const listed = [report('a'), event('loop')]
    expect([...heldEntries('entries', listed, barrier, at).ids]).toEqual(['a'])
    takeExpectedReport('b')
    // On its way, not queued yet: still owed — or `a` would go alone just before it.
    expect([...heldEntries('entries', listed, barrier, at).ids]).toEqual(['a'])
    settleReport('b')
    expect(heldEntries('entries', listed, barrier, at).ids.size).toBe(0)
  })

  test('a sibling whose report is already queued holds nobody back', () => {
    expectReport('a', lead)
    expectReport('b', lead)
    takeExpectedReport('a')
    takeExpectedReport('b')
    const listed = [report('a'), report('b')]
    expect(heldEntries('entries', listed, barrier, at).ids.size).toBe(0)
  })

  test("another session's children are not this report's siblings", () => {
    expectReport('elsewhere', { sessionId: 'other' })
    expect(heldEntries('entries', [report('a')], barrier, at).ids.size).toBe(0)
  })

  test('none waits past the hold limit, and the limit is when the drain looks again', () => {
    expectReport('slow', lead)
    const listed = [report('a')]
    expect(heldEntries('entries', listed, barrier, at).releaseAt).toBe(at + MAX_REPORT_HOLD_MS)
    expect(heldEntries('entries', listed, barrier, at + MAX_REPORT_HOLD_MS).ids.size).toBe(0)
  })

  test('a band already claimed is past deciding; without a ledger nothing is held', () => {
    expectReport('slow', lead)
    const claimed = report('a')
    claimed.value = { ...claimed.value, batch: 'a' }
    expect(heldEntries('entries', [claimed], barrier, at).ids.size).toBe(0)
    expect(heldEntries('entries', [report('a')], undefined, at).ids.size).toBe(0)
  })
})

describe('the delegation ledger', () => {
  test('says when a report settles or a wait is dropped, to whoever subscribed', () => {
    const settled: string[] = []
    const unsubscribe = onReportSettled((sessionId) => settled.push(sessionId))
    expectReport('a', lead)
    expectReport('b', lead)
    expect(takeExpectedReport('a')).toBe(true)
    expect(takeExpectedReport('a')).toBe(false)
    expect(settled).toEqual([])
    settleReport('a')
    dropExpectedReport('b')
    unsubscribe()
    dropExpectedReport('b')
    expect(settled).toEqual(['entries', 'entries'])
    expect(awaitsReports('entries')).toBe(false)
  })

  test('a new wait while a report is on its way stands after that report settles', () => {
    expectReport('a', lead)
    takeExpectedReport('a')
    // The delegator messaged the child again: the next run owes it another report.
    expectReport('a')
    settleReport('a')
    expect(awaitsReports('entries')).toBe(true)
    expect(takeExpectedReport('a')).toBe(true)
  })
})
