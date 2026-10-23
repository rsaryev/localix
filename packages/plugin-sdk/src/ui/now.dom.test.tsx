import { afterAll, afterEach, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { WorkItemVisibilityProvider } from './visibility'
import { useNow } from './now'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
afterEach(() => {
  jest.useRealTimers()
})

/** Renders `useNow` and returns the last value it gave, with a way to move the clock. */
async function renderClock(options: { visible?: boolean; enabled?: boolean } = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  jest.useFakeTimers()
  jest.setSystemTime(1_000)
  const seen: number[] = []
  function Probe() {
    seen.push(useNow(1000, options.enabled ?? true))
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <WorkItemVisibilityProvider visible={options.visible ?? true}>
        <Probe />
      </WorkItemVisibilityProvider>,
    ),
  )
  return {
    last: () => seen.at(-1),
    advance: async (ms: number) => {
      await act(async () => jest.advanceTimersByTime(ms))
    },
    unmount: () => act(async () => root.unmount()),
  }
}

test('the clock re-reads the time at once and then every interval', async () => {
  const clock = await renderClock()
  try {
    expect(clock.last()).toBe(1_000)
    await clock.advance(1)
    expect(clock.last()).toBe(1_001)
    await clock.advance(998)
    expect(clock.last()).toBe(1_001)
    await clock.advance(1)
    expect(clock.last()).toBe(2_000)
  } finally {
    await clock.unmount()
  }
})

test('a hidden view or a disabled clock does not tick', async () => {
  for (const options of [{ visible: false }, { enabled: false }]) {
    const clock = await renderClock(options)
    try {
      await clock.advance(5000)
      expect(clock.last()).toBe(1_000)
    } finally {
      await clock.unmount()
    }
  }
})
