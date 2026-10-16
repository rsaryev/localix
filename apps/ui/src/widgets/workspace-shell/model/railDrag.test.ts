import { describe, expect, it } from 'bun:test'
import { IDLE_DRAG, beginDrag, hoverItem, hoverZone, leaveZone } from './railDrag'

describe('railDrag transitions', () => {
  it('beginDrag sets the id and clears every hover target', () => {
    expect(beginDrag('files')).toEqual({ dragId: 'files', target: null, overZone: null })
  })

  it('hoverItem records the target + side', () => {
    const s = hoverItem(beginDrag('a'), 'b', true)
    expect(s.target).toEqual({ id: 'b', after: true })
    expect(s.overZone).toBe('bar')
  })

  it('hoverItem returns the SAME reference when nothing changes (render bail-out)', () => {
    const prev = {
      dragId: 'a',
      target: { id: 'b', after: true },
      overZone: 'bar' as const,
    }
    expect(hoverItem(prev, 'b', true)).toBe(prev)
  })

  it('hoverItem returns a NEW reference when the side flips', () => {
    const prev = {
      dragId: 'a',
      target: { id: 'b', after: true },
      overZone: 'bar' as const,
    }
    expect(hoverItem(prev, 'b', false)).not.toBe(prev)
  })

  it('hoverZone highlights the rail and optionally clears a stale item target', () => {
    const prev = {
      dragId: 'a',
      target: { id: 'b', after: true },
      overZone: null,
    }
    expect(hoverZone(prev, false)).toEqual({ ...prev, overZone: 'bar' })
    expect(hoverZone(prev, true)).toEqual({ ...prev, target: null, overZone: 'bar' })
    expect(hoverZone(prev, true, 'top').overZone).toBe('top')
    expect(hoverZone(prev, true, 'bottom').overZone).toBe('bottom')
    expect(hoverZone(prev, true, 'status').overZone).toBe('status')
  })

  it('leaveZone clears the rail highlight and insertion target', () => {
    const over = {
      dragId: 'a',
      target: { id: 'b', after: true },
      overZone: 'bar' as const,
    }
    expect(leaveZone(over)).toEqual({ ...over, target: null, overZone: null })
    expect(leaveZone(IDLE_DRAG)).toBe(IDLE_DRAG)
  })
})
