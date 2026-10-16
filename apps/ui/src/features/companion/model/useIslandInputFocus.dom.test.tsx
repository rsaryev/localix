import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useRef } from 'react'
import { Textarea } from '@localixai/kit/textarea'
import { useIslandInputFocus } from './useIslandInputFocus'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('reveal focuses an input arriving late, and typing or rerendering never resets focus', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  function Host({ open, ready }: { open: boolean; ready: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useIslandInputFocus(ref, open)
    return <div ref={ref}>{ready && <Textarea aria-label="Quick request" />}</div>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await React.act(async () => root.render(<Host open ready={false} />))
    await React.act(async () => root.render(<Host open ready />))
    const input = host.querySelector('textarea')!
    expect(document.activeElement).toBe(input)
    input.value = 'Retain this draft'
    input.setSelectionRange(6, 6)
    await React.act(async () => root.render(<Host open ready />))
    expect(input.selectionStart).toBe(6)
    await React.act(async () => root.render(<Host open={false} ready />))
    input.blur()
    await React.act(async () => root.render(<Host open ready />))
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Retain this draft')
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
