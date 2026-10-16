import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useIsland } from './useIsland'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const question = { kind: 'interaction', key: 'waiting-question' } as never

test('a focused workspace holds a new request until the person leaves the app', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host({ waiting, held }: { waiting: boolean; held: boolean }) {
    island = useIsland(waiting ? [question] : [], { holdAttention: held })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await React.act(async () => root.render(<Host waiting={false} held />))
    await React.act(async () => root.render(<Host waiting held />))
    expect(island.expanded).toBe(false)
    expect(island.selectedKey).toBeNull()
    await React.act(async () => root.render(<Host waiting held={false} />))
    expect(island.expanded).toBe(true)
    expect(island.selectedKey).toBe('waiting-question')
  } finally {
    await React.act(async () => root.unmount())
  }
})

test('returning to a workspace folds a request card, and an explicit open still works', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host({ held }: { held: boolean }) {
    island = useIsland([question], { holdAttention: held })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await React.act(async () => root.render(<Host held={false} />))
    expect(island.selectedKey).toBe('waiting-question')
    await React.act(async () => root.render(<Host held />))
    expect(island.expanded).toBe(false)
    await React.act(async () => island.dispatch({ type: 'activate' }))
    expect(island.expanded).toBe(true)
  } finally {
    await React.act(async () => root.unmount())
  }
})
