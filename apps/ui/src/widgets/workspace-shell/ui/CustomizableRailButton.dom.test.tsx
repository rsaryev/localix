import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const noOp = () => {}

async function renderButton(surface: 'rail' | 'status', active: boolean) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { CustomizableRailButton } = await import('./CustomizableRailButton')

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <CustomizableRailButton
        entry={{
          id: 'keep-awake',
          icon: <span />,
          label: 'Keep awake',
          onClick: noOp,
          active,
        }}
        area={surface === 'status' ? 'status' : 'bottom'}
        drag={{ dragId: null, target: null, overZone: null }}
        isFirst
        isLast
        justPinned={false}
        surface={surface}
        onDragStart={noOp}
        onDragOverItem={noOp}
        onDropItem={noOp}
        onDragEnd={noOp}
        onMoveWithin={noOp}
        onMoveArea={noOp}
        onReset={noOp}
      />,
    ),
  )
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Keep awake"]')!
  // Token-exact, not substring: IconButton's own base classes already carry
  // `aria-pressed:bg-surface-active`, so `className.includes('bg-surface-active')`
  // is true even for an inactive button and would pass these tests by accident.
  const tokens = new Set(button.className.split(/\s+/).filter(Boolean))
  return { button, tokens, cleanup: () => host.remove() }
}

describe('CustomizableRailButton active state', () => {
  // THE REGRESSION. `railBtnActive` hangs its marker 4px OUTSIDE the button's left
  // edge and 20px tall — right for a vertical rail, wrong inside a ~22px status
  // strip, where it overshoots the cell and lands on the `divide-x` hairline the
  // bar already draws between items. Activating "keep awake" therefore showed a
  // stray, misaligned line beside the button instead of the button looking on.
  test('the status bar does not borrow the vertical rail edge marker', async () => {
    const { tokens, cleanup } = await renderButton('status', true)
    try {
      expect(tokens).not.toContain('before:-left-1')
      expect(tokens).not.toContain('before:h-5')
      // Still legible as "on": the cell is tinted and carries a marker of its own.
      expect(tokens).toContain('bg-surface-active')
      expect(tokens).toContain('before:inset-x-0')
      expect(tokens).toContain('before:bottom-0')
    } finally {
      cleanup()
    }
  })

  test('the vertical rail keeps its edge marker', async () => {
    const { tokens, cleanup } = await renderButton('rail', true)
    try {
      expect(tokens).toContain('before:-left-1')
      expect(tokens).toContain('bg-surface-active')
      expect(tokens).not.toContain('before:inset-x-0')
    } finally {
      cleanup()
    }
  })

  test('an inactive status button carries no marker at all', async () => {
    const { tokens, cleanup } = await renderButton('status', false)
    try {
      expect(tokens).not.toContain('bg-surface-active')
      expect(tokens).not.toContain('before:-left-1')
      expect(tokens).not.toContain('before:inset-x-0')
    } finally {
      cleanup()
    }
  })
})
