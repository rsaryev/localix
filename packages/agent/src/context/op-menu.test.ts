import { describe, expect, it } from 'bun:test'
import { operationMenu, heavyMutateInputs, recoverableReadResult, ELISION_MARKER } from './op-menu'
import { msg, userMsg, namedTool } from './_test-helpers'

const BIG = 'A'.repeat(8000)

describe('heavyMutateInputs', () => {
  it('extracts the write/edit content field', () => {
    expect(heavyMutateInputs(namedTool('write', { path: 'f.ts', content: 'hello' }))).toEqual([
      { field: 'content', text: 'hello' },
    ])
  })

  it('extracts an apply_patch / patch body', () => {
    expect(heavyMutateInputs(namedTool('apply_patch', { patch: '@@ body @@' }))).toEqual([
      { field: 'patch', text: '@@ body @@' },
    ])
  })

  it('extracts the edits array (JSON) and the single-edit shorthand', () => {
    const edits = [{ old_string: 'a', new_string: 'b' }]
    expect(heavyMutateInputs(namedTool('edit', { path: 'f.ts', edits }))).toEqual([
      { field: 'edits', text: JSON.stringify(edits) },
    ])
    expect(
      heavyMutateInputs(namedTool('edit', { path: 'f.ts', old_string: 'aaa', new_string: 'bbb' })),
    ).toEqual([
      { field: 'old_string', text: 'aaa' },
      { field: 'new_string', text: 'bbb' },
    ])
  })

  it("extracts a batched write's files array (JSON)", () => {
    const files = [{ path: 'a.ts', content: 'x' }]
    expect(heavyMutateInputs(namedTool('write', { files }))).toEqual([
      { field: 'files', text: JSON.stringify(files) },
    ])
  })

  it('returns nothing for a non-mutating tool', () => {
    expect(heavyMutateInputs(namedTool('read', { path: 'f.ts' }, { resultText: 'x' }))).toEqual([])
    expect(heavyMutateInputs(namedTool('bash', { command: 'ls' }, { resultText: 'x' }))).toEqual([])
  })

  it('skips already-elided content (idempotent across turns)', () => {
    expect(
      heavyMutateInputs(namedTool('write', { path: 'f.ts', content: `[${ELISION_MARKER}]` })),
    ).toEqual([])
  })

  it('returns nothing for an item that has not completed', () => {
    expect(
      heavyMutateInputs(namedTool('write', { path: 'f.ts', content: 'x' }, { status: 'pending' })),
    ).toEqual([])
  })

  it('does NOT elide a completed file_change with a FAILED hunk (unapplied → not on disk)', () => {
    // The patch body must stay verbatim: a failed hunk was never written, so it
    // can't be recovered by re-reading and would be lost if elided to a pointer.
    const item = namedTool(
      'apply_patch',
      { patch: '@@ body @@' },
      {
        status: 'completed',
        changes: [{ path: 'f.ts', kind: 'modify', failed: true }],
      },
    )
    expect(heavyMutateInputs(item)).toEqual([])
  })

  it('still elides a completed file_change whose hunks all applied', () => {
    const item = namedTool(
      'apply_patch',
      { patch: '@@ body @@' },
      {
        status: 'completed',
        changes: [{ path: 'f.ts', kind: 'modify' }],
      },
    )
    expect(heavyMutateInputs(item)).toEqual([{ field: 'patch', text: '@@ body @@' }])
  })
})

describe('recoverableReadResult', () => {
  it('returns the model-facing result for a read-class tool', () => {
    expect(
      recoverableReadResult(namedTool('read', { path: 'f.ts' }, { resultText: 'file body' })),
    ).toBe('file body')
    expect(recoverableReadResult(namedTool('search', { query: 'x' }, { resultText: 'hits' }))).toBe(
      'hits',
    )
  })

  it('returns undefined for a non-read tool (bash output is not re-readable)', () => {
    expect(
      recoverableReadResult(namedTool('bash', { command: 'ls' }, { resultText: 'out' })),
    ).toBeUndefined()
  })

  it('returns undefined for empty or already-elided results', () => {
    // The elided case carries the marker the way `apply.ts` writes it — inside the
    // bracketed placeholder. A bare `x <marker>` is what DATA looks like, not a pointer.
    expect(
      recoverableReadResult(namedTool('read', { path: 'f.ts' }, { resultText: '' })),
    ).toBeUndefined()
    expect(
      recoverableReadResult(
        namedTool('read', { path: 'f.ts' }, { resultText: `[Old tool output ${ELISION_MARKER}]` }),
      ),
    ).toBeUndefined()
  })
})

describe('operationMenu', () => {
  it('returns just verbatim (retention 1) for a message with no compressible content', () => {
    const menu = operationMenu(userMsg('hello there'), false)
    expect(menu).toHaveLength(1)
    expect(menu[0].kind).toBe('verbatim')
    expect(menu[0].retention).toBe(1)
    expect(menu[0].cost).toBeGreaterThan(0)
  })

  it('always starts at verbatim and is COST-STRICTLY-DECREASING (the allocator invariant)', () => {
    const m = msg({ items: [namedTool('bash', { command: 'x' }, { resultText: BIG })] })
    const menu = operationMenu(m, false)
    expect(menu.length).toBeGreaterThan(1) // a lossy chain exists
    expect(menu[0].kind).toBe('verbatim')
    expect(menu[0].retention).toBe(1)
    for (let i = 1; i < menu.length; i++) {
      expect(menu[i].cost).toBeLessThan(menu[i - 1].cost) // strictly cheaper each step
    }
  })

  it('keeps every retention in (0, 1]', () => {
    const m = msg({ items: [namedTool('bash', { command: 'x' }, { resultText: BIG })] })
    for (const op of operationMenu(m, false)) {
      expect(op.retention).toBeGreaterThan(0)
      expect(op.retention).toBeLessThanOrEqual(1)
    }
  })

  it('offers a near-lossless elide op for recoverable (write) content, cheaper than verbatim', () => {
    const m = msg({ items: [namedTool('write', { path: 'a.ts', content: BIG }, {})] })
    const menu = operationMenu(m, false)
    const elide = menu.find((o) => o.kind === 'elide')
    expect(elide).toBeDefined()
    expect(elide!.lossless).toBe(true)
    expect(elide!.cost).toBeLessThan(menu[0].cost)
  })

  it('stacks both stages (lossless elide + lossy chain) for a mixed message, still cost-monotonic', () => {
    const m = msg({
      items: [
        namedTool('write', { path: 'a.ts', content: BIG }, {}),
        namedTool('bash', { command: 'x' }, { resultText: BIG }),
      ],
    })
    const menu = operationMenu(m, false)
    expect(menu.some((o) => o.kind === 'elide' && o.lossless)).toBe(true)
    expect(
      menu.some((o) => o.kind === 'pointer' || o.kind === 'oneline' || o.kind === 'truncate'),
    ).toBe(true)
    for (let i = 1; i < menu.length; i++) expect(menu[i].cost).toBeLessThan(menu[i - 1].cost)
  })
})
