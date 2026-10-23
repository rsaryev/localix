import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../testing/dom'
import { SearchInput } from './search-input'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

describe('SearchInput clear action', () => {
  test('clears the query without moving focus out of the search field', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let nextValue: string | undefined

    await act(async () => {
      root.render(
        <SearchInput
          value="models"
          onValueChange={(value) => {
            nextValue = value
          }}
          aria-label="Search models"
          role="combobox"
          aria-expanded="true"
          aria-controls="model-results"
        />,
      )
    })

    const input = container.querySelector('input')
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')
    input?.focus()

    await act(async () => {
      clear?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      clear?.click()
    })

    expect(nextValue).toBe('')
    expect(document.activeElement).toBe(input)
    expect(input?.getAttribute('role')).toBe('combobox')
    expect(input?.getAttribute('aria-expanded')).toBe('true')
    expect(input?.getAttribute('aria-controls')).toBe('model-results')

    // Hand focus back to the body BEFORE detaching the tree. jsdom leaves
    // `document.activeElement` pointing at a removed node, and the next suite's Radix
    // layer saves that detached node as its restore target — so closing that menu
    // restores focus to nothing and its own focus assertion fails, far from here.
    input?.blur()
    await act(async () => root.unmount())
    container.remove()
  })
})
