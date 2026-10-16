import { expect, test } from 'bun:test'
import { createDiagnosticsSnapshot } from './lsp-diagnostics-snapshot'
import type { LspDiagnostic } from './lsp-response-types'

const diagnostic = (message: string): LspDiagnostic => ({
  message,
  severity: 1,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
})

test('snapshots retain push-first file order and dedupe before normalizing metadata', () => {
  const first = diagnostic('duplicate')
  const second = { ...first, tags: [2] }
  const independent = diagnostic('independent')
  const push = new Map([
    ['/push', [first]],
    ['/shared', [first]],
  ])
  const pull = new Map([
    ['/pull', [independent]],
    ['/shared', [second]],
  ])
  const { buildDiagnosticsSnapshot } = createDiagnosticsSnapshot(push, pull, () => {})
  const snapshot = buildDiagnosticsSnapshot()
  expect(Object.keys(snapshot)).toEqual(['/push', '/shared', '/pull'])
  expect(snapshot['/shared']).toEqual([first])
  expect(snapshot['/shared']![0]).toBe(first)
  snapshot['/shared']!.pop()
  expect(buildDiagnosticsSnapshot()['/shared']).toEqual([first])
  push.delete('/shared')
  expect(buildDiagnosticsSnapshot()['/shared']).toEqual([{ ...first, tags: [2] }])
})

test('unhandled reports leave old diagnostics untouched and publish nothing', () => {
  const existing = [diagnostic('old')]
  const pull = new Map([['/target', existing]])
  let flushes = 0
  const { mergePullResults } = createDiagnosticsSnapshot(new Map(), pull, () => {
    flushes++
  })
  expect(
    mergePullResults('/target', [
      {
        handled: false,
        matched: true,
        byFile: new Map([['/target', []]]),
      },
    ]),
  ).toEqual({ handled: false, matched: false })
  expect(pull.get('/target')).toBe(existing)
  expect(flushes).toBe(0)
})

test('handled reports merge every batch, clear a matched omitted file and flush after updating', () => {
  const first = diagnostic('first')
  const second = diagnostic('second')
  const pull = new Map([
    ['/target', [diagnostic('old')]],
    ['/unmentioned', [first]],
  ])
  const published: unknown[] = []
  const { mergePullResults, buildDiagnosticsSnapshot } = createDiagnosticsSnapshot(
    new Map(),
    pull,
    () => {
      published.push([...pull])
    },
  )
  expect(
    mergePullResults('/target', [
      { handled: true, matched: true, byFile: new Map([['/related', [first]]]) },
      { handled: false, matched: false, byFile: new Map([['/related', [first, second]]]) },
    ]),
  ).toEqual({ handled: true, matched: true })
  expect(pull.get('/target')).toEqual([])
  expect(pull.get('/related')).toEqual([first, second])
  expect(pull.get('/related')![0]).toBe(first)
  expect(pull.get('/unmentioned')).toEqual([first])
  expect(published).toEqual([[...pull]])
  expect(buildDiagnosticsSnapshot()['/target']).toEqual([])
})
