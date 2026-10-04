/**
 * attachFailedResources decides WHERE a failed subresource is surfaced: the FULL list on
 * a snapshot-bearing result, or only NEW-since-last-command failures on a diff-only DRIVE
 * result (so a mid-session 404 shows up on the action that hit it — once, not forever).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { attachFailedResources } from './attach-failed-resources'
import { installResourceErrorCapture } from './resource-errors'
import type { VfCommandResult } from '../protocol/index'

const snapResult = (): VfCommandResult => ({
  action: 'snapshot',
  snapshot: {
    tree: '- a',
    stats: { nodes: 1, interactive: 0, chars: 1 },
    url: 'http://x',
    title: 'X',
  },
})
const clickResult = (): VfCommandResult => ({
  action: 'click',
  note: 'clicked',
  diff: '(no visible change)',
})

describe('attachFailedResources (pure)', () => {
  test('attaches the FULL list to a snapshot-bearing result and marks them reported', () => {
    const reported = new Set<string>()
    const r = attachFailedResources(snapResult(), ['stylesheet a.css', 'script b.js'], reported)
    expect(r?.snapshot?.failedResources).toEqual(['stylesheet a.css', 'script b.js'])
    expect(r?.failedResources).toBeUndefined() // full list rides the snapshot, not result-level
    expect([...reported].sort()).toEqual(['script b.js', 'stylesheet a.css'])
  })

  test('a diff-only DRIVE result reports only failures NEW since the last command', () => {
    const reported = new Set<string>(['stylesheet a.css']) // already surfaced earlier
    const r = attachFailedResources(clickResult(), ['stylesheet a.css', 'script b.js'], reported)
    expect(r?.failedResources).toEqual(['script b.js']) // only the new one
    expect(r?.snapshot).toBeUndefined()
    expect(reported.has('script b.js')).toBe(true)
  })

  test('a diff-only result with NO new failures attaches nothing', () => {
    const reported = new Set<string>(['stylesheet a.css'])
    const r = attachFailedResources(clickResult(), ['stylesheet a.css'], reported)
    expect(r?.failedResources).toBeUndefined()
  })

  test('a non-DRIVE diff-only result (console/evaluate) is never annotated', () => {
    const reported = new Set<string>()
    const r = attachFailedResources({ action: 'console', console: [] }, ['script b.js'], reported)
    expect(r?.failedResources).toBeUndefined()
    expect([...reported]).toEqual([]) // untouched
  })

  test('bounds the new-failure list', () => {
    const r = attachFailedResources(clickResult(), ['a', 'b', 'c', 'd', 'e', 'f'], new Set(), 4)
    expect(r?.failedResources).toHaveLength(4)
  })

  test('no failures / no result → passthrough', () => {
    expect(attachFailedResources(clickResult(), [], new Set())?.failedResources).toBeUndefined()
    expect(attachFailedResources(undefined, ['x'], new Set())).toBeUndefined()
  })
})

describe('attachFailedResources + live resource capture flow', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a stylesheet that 404s AFTER a snapshot surfaces on the next diff-only click, once', () => {
    const cap = installResourceErrorCapture()
    const reported = new Set<string>()
    try {
      // 1) First command (snapshot) on a clean page → nothing.
      expect(
        attachFailedResources(snapResult(), cap.read(), reported)?.snapshot?.failedResources,
      ).toBeUndefined()

      // 2) A stylesheet fails now (mid-session file move) — capture-phase error event.
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'assets/theme.css'
      document.head.appendChild(link)
      link.dispatchEvent(new Event('error'))

      // 3) A diff-only click surfaces the NEW failure.
      expect(attachFailedResources(clickResult(), cap.read(), reported)?.failedResources).toEqual([
        'stylesheet assets/theme.css',
      ])

      // 4) A subsequent click does NOT repeat it.
      expect(
        attachFailedResources(clickResult(), cap.read(), reported)?.failedResources,
      ).toBeUndefined()
    } finally {
      cap.uninstall()
      document.head.innerHTML = ''
    }
  })
})
