import { describe, expect, test } from 'bun:test'
import { confirmCopy } from './confirmCopy'

describe('confirmCopy', () => {
  test('prune copy is target-specific', () => {
    const c = confirmCopy({ kind: 'prune', target: 'volumes' })
    expect(c.title).toBe('Prune unused volumes?')
    expect(c.description).toContain('their data is lost')
    expect(c.confirmLabel).toBe('Prune')
  })

  test('entity removals name the target', () => {
    expect(confirmCopy({ kind: 'image', id: 'abc', ref: 'nginx:latest' }).title).toBe(
      'Remove image nginx:latest?',
    )
    expect(confirmCopy({ kind: 'volume', name: 'pgdata' }).title).toBe('Remove volume pgdata?')
    expect(confirmCopy({ kind: 'network', id: 'n1', name: 'backend' }).title).toBe(
      'Remove network backend?',
    )
  })

  test('project batch copy reflects action + member count', () => {
    const stop = confirmCopy({ kind: 'project', action: 'stop', project: 'shop', ids: ['a', 'b'] })
    expect(stop.title).toBe('Stop all of shop?')
    expect(stop.description).toContain('all 2 container(s)')
    expect(stop.confirmLabel).toBe('Stop all')
    expect(
      confirmCopy({ kind: 'project', action: 'restart', project: 'shop', ids: ['a'] }).confirmLabel,
    ).toBe('Restart all')
  })

  test('compose-up copy', () => {
    const up = confirmCopy({ kind: 'compose-up', project: 'shop' })
    expect(up.title).toBe('Bring up shop?')
    expect(up.confirmLabel).toBe('Up')
  })
})
