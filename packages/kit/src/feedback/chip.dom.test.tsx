import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../testing/dom'
import { ChipButton } from './chip'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

async function mount(node: React.ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return host
}

describe('ChipButton', () => {
  test('is a named button that acts when pressed', async () => {
    let pressed = 0
    const host = await mount(
      <ChipButton aria-label="Show packages tagged atlas" onClick={() => pressed++}>
        atlas
      </ChipButton>,
    )
    const button = host.querySelector('button')!
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-label')).toBe('Show packages tagged atlas')
    await act(async () => button.click())
    expect(pressed).toBe(1)
  })

  test('does nothing while disabled', async () => {
    let pressed = 0
    const host = await mount(
      <ChipButton disabled onClick={() => pressed++}>
        atlas
      </ChipButton>,
    )
    await act(async () => host.querySelector('button')!.click())
    expect(pressed).toBe(0)
  })

  test('a leading icon and the label share one pill', async () => {
    const host = await mount(
      <ChipButton>
        <svg aria-hidden />
        Games
      </ChipButton>,
    )
    const button = host.querySelector('button')!
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent).toBe('Games')
  })
})
