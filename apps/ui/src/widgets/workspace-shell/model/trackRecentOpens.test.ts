import { describe, expect, it } from 'bun:test'
import { trackRecentOpens } from './trackRecentOpens'
import type { RailEntry } from '../ui/shellTypes'

function entry(id: string, onClick: () => void): RailEntry {
  return { id, icon: null, label: id, active: false, onClick }
}

describe('trackRecentOpens', () => {
  it('records the open and still runs the original handler, in that order', () => {
    const calls: string[] = []
    const entries = new Map([['view:a', entry('view:a', () => calls.push('open'))]])

    trackRecentOpens(entries, new Set(['view:a']), (id) => calls.push(`touch:${id}`))
      .get('view:a')!
      .onClick()

    expect(calls).toEqual(['touch:view:a', 'open'])
  })

  it('leaves a pinned entry alone — touching it would evict a genuine recent', () => {
    const original = entry('view:pinned', () => {})
    const tracked = trackRecentOpens(new Map([['view:pinned', original]]), new Set(), () => {
      throw new Error('a pinned entry must not be recorded as recent')
    })

    expect(tracked.get('view:pinned')).toBe(original)
    tracked.get('view:pinned')!.onClick()
  })

  it('preserves every entry and its other fields', () => {
    const entries = new Map([
      ['view:a', { ...entry('view:a', () => {}), plugin: true, label: 'Alpha' }],
      ['view:b', entry('view:b', () => {})],
    ])
    const tracked = trackRecentOpens(entries, new Set(['view:a']), () => {})

    expect([...tracked.keys()]).toEqual(['view:a', 'view:b'])
    expect(tracked.get('view:a')?.label).toBe('Alpha')
    expect(tracked.get('view:a')?.plugin).toBe(true)
  })
})
