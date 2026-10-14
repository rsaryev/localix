import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./OrderBook.tsx', import.meta.url), 'utf8')

test('a stale order book reports through the host problem line', () => {
  expect(source).toContain('<ProblemLine')
  expect(source).not.toContain('border-status-error/20')
})

test('staleness is stated once, by the vocabulary — not spelled out again in a title', () => {
  // This used to pin `title: 'Book unreachable — showing the last snapshot.'`. `consequence: stale`
  // makes ProblemLine render "showing the last valid version" itself, so the hand-written half was
  // the same fact on the same line twice.
  expect(source).toContain("consequence: hasView ? 'stale' : 'blocked'")
  expect(source).not.toContain('showing the last snapshot')
})
