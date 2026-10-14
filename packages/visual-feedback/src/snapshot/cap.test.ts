/**
 * Snapshot node cap — a huge page must not dump unbounded tokens into the agent's
 * context. buildSnapshot emits at most maxNodes lines, then appends a truncation hint.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

describe('snapshot node cap', () => {
  it('caps emitted nodes and appends a truncation hint', () => {
    document.body.innerHTML = Array.from({ length: 50 }, (_, i) => `<button>b${i}</button>`).join(
      '',
    )
    const snap = buildSnapshot(createRefRegistry(), { maxNodes: 10 })
    expect(snap.stats.nodes).toBe(10)
    const lines = snap.tree.split('\n')
    // 10 emitted + 1 truncation hint line.
    expect(lines).toHaveLength(11)
    expect(lines[lines.length - 1]).toContain('truncated at 10 nodes')
  })

  it('does not add a hint when under the cap', () => {
    document.body.innerHTML = '<button>a</button><button>b</button>'
    const snap = buildSnapshot(createRefRegistry(), { maxNodes: 800 })
    expect(snap.stats.nodes).toBe(2)
    expect(snap.tree).not.toContain('truncated')
  })
})
