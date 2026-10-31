import { afterAll, afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'
import { configurePlatformCapabilities } from './platformCapabilities'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})
afterAll(async () => teardown())

async function mountSwitch(shell: (command: string, args?: Record<string, unknown>) => unknown) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { __resetIslandSetting, useIslandEnabled } = await import('./islandSetting')
  __resetIslandSetting(true)
  const invoke = mock(async (command: string, args?: Record<string, unknown>) =>
    shell(command, args),
  )
  cleanups.push(
    configurePlatformCapabilities({
      desktop: { invoke: invoke as never, invoker: () => invoke as never },
    }),
  )
  const seen: Array<boolean | null> = []
  function Probe() {
    const value = useIslandEnabled()
    React.useEffect(() => {
      seen.push(value)
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => {
    root.render(<Probe />)
    await settle()
  })
  cleanups.push(() => React.act(async () => root.unmount()))
  return { invoke, seen }
}

test('the agent island is off until the person turns it on', async () => {
  const { seen, invoke } = await mountSwitch((command) =>
    command === 'island_enabled' ? false : undefined,
  )
  expect(invoke).toHaveBeenCalledWith('island_enabled')
  expect(seen.at(-1)).toBe(false)
})

test('turning it on asks the shell, and the switch follows at once', async () => {
  const { seen, invoke } = await mountSwitch((command) =>
    command === 'island_enabled' ? false : undefined,
  )
  const { setIslandEnabled } = await import('./islandSetting')
  const React = await import('react')
  await React.act(async () => {
    setIslandEnabled(true)
    await settle()
  })
  expect(invoke).toHaveBeenCalledWith('set_island_enabled', { enabled: true })
  expect(seen.at(-1)).toBe(true)
})

test('outside the macOS desktop app there is no switch at all', async () => {
  const { __resetIslandSetting } = await import('./islandSetting')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useIslandEnabled } = await import('./islandSetting')
  __resetIslandSetting(false)
  const seen: Array<boolean | null> = []
  function Probe() {
    seen.push(useIslandEnabled())
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => {
    root.render(<Probe />)
    await settle()
  })
  cleanups.push(() => React.act(async () => root.unmount()))
  expect(seen.every((value) => value === null)).toBe(true)
})
