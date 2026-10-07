import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useVisiblePolling } from './visibility'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('replayed polling refreshes immediately after an inherited request, without overlap or interval delay', async () => {
  const { act, StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  function Probe() {
    useVisiblePolling({
      intervalMs: 5_000,
      immediate: true,
      onTick: () => {
        calls++
        return calls === 1 ? pending : Promise.resolve()
      },
    })
    return null
  }
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <Probe />
        </StrictMode>,
      ),
    )
    expect(calls).toBe(1)
    await act(async () => {
      release()
      await pending
    })
    expect(calls).toBe(2)
  } finally {
    await act(async () => root.unmount())
  }
})

test('a stopped owner does not replay polling after its inherited request settles', async () => {
  const { act, StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  function Probe() {
    useVisiblePolling({
      intervalMs: 5_000,
      immediate: true,
      onTick: () => {
        calls++
        return pending
      },
    })
    return null
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    ),
  )
  await act(async () => root.unmount())
  release()
  await pending
  expect(calls).toBe(1)
})
