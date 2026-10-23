import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { LayersPanel } from './LayersPanel'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

test('unselected and locked elements are focusable; lock actions do not change selection', async () => {
  const space = applyOps(
    emptySpace(),
    [{ op: 'create', id: 'note', type: 'note', x: 0, y: 0, locked: true, props: { text: 'Plan' } }],
    { registry: spaceTypes },
  ).space
  const selections: { ids: string[]; add: boolean | undefined }[] = []
  const writes: (readonly SpaceOp[])[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <LayersPanel
          space={space}
          selected={new Set()}
          select={(ids, add) => selections.push({ ids: [...ids], add })}
          commit={(ops) => writes.push(ops)}
          onClose={() => undefined}
        />,
      ),
    )
    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-slot="workbench-list-row-trigger"]',
    )!
    expect(trigger.tabIndex).toBe(0)
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    expect(selections).toEqual([{ ids: ['note'], add: false }])
    await act(async () =>
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
    )
    expect(selections.at(-1)).toEqual({ ids: ['note'], add: true })
    const unlock = host.querySelector<HTMLButtonElement>('button[aria-label="Unlock"]')!
    const selectionCount = selections.length
    await act(async () => unlock.click())
    expect(writes).toEqual([[{ op: 'update', id: 'note', locked: false }]])
    expect(selections).toHaveLength(selectionCount)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
