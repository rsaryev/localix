import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ISLAND_TIMING, useIsland } from './useIsland'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('a portaled island menu keeps the island open; a real outside click folds it', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host() {
    island = useIsland([])
    return null
  }
  const root = createRoot(document.createElement('div'))
  const portal = document.createElement('div')
  portal.dataset.islandOverlay = ''
  const row = document.createElement('span')
  portal.append(row)
  document.body.append(portal)
  try {
    await React.act(async () => root.render(<Host />))
    await React.act(async () => island.dispatch({ type: 'activate' }))
    await React.act(async () =>
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    )
    expect(island.expanded).toBe(true)
    await React.act(async () =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    )
    expect(island.expanded).toBe(false)
  } finally {
    portal.remove()
    await React.act(async () => root.unmount())
  }
})

test('folding cancels delayed hover and requires leaving before hover can reopen', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host() {
    island = useIsland([])
    return null
  }
  const root = createRoot(document.createElement('div'))
  const enter = () => island.onPointerEnter({ pointerType: 'mouse' } as never)
  const wait = () => new Promise((resolve) => setTimeout(resolve, ISLAND_TIMING.hoverEnterMs + 40))
  try {
    await React.act(async () => root.render(<Host />))
    await React.act(async () => {
      enter()
      island.collapse()
      await wait()
    })
    expect(island.expanded).toBe(false)
    await React.act(async () => {
      enter()
      await wait()
    })
    expect(island.expanded).toBe(false)
    await React.act(async () => {
      island.onPointerLeave()
      enter()
      await wait()
    })
    expect(island.expanded).toBe(true)
    await React.act(async () => window.dispatchEvent(new Event('blur')))
    expect(island.expanded).toBe(false)
  } finally {
    await React.act(async () => root.unmount())
  }
})

test('a waiting question opens fully once, while manual folding remains respected', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  const question = { kind: 'question', key: 'waiting-question' } as never
  function Host({ waiting }: { waiting: boolean }) {
    island = useIsland(waiting ? [question] : [])
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await React.act(async () => root.render(<Host waiting={false} />))
    await React.act(async () => root.render(<Host waiting />))
    expect(island.expanded).toBe(true)
    expect(island.selectedKey).toBe('waiting-question')
    expect(island.focusComposer).toBe(false)
    await React.act(async () => {
      island.onPointerLeave()
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    expect(island.expanded).toBe(true)
    await React.act(async () => island.collapse())
    await React.act(async () => root.render(<Host waiting />))
    expect(island.expanded).toBe(false)
  } finally {
    await React.act(async () => root.unmount())
  }
})

test('an existing request opens on entry and a replacement request stays fully open', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host({ requestKey }: { requestKey: string }) {
    island = useIsland([{ kind: 'interaction', key: requestKey } as never])
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await React.act(async () => root.render(<Host requestKey="approval-1" />))
    expect(island.expanded).toBe(true)
    expect(island.selectedKey).toBe('approval-1')
    await React.act(async () => root.render(<Host requestKey="approval-2" />))
    expect(island.expanded).toBe(true)
    expect(island.selectedKey).toBe('approval-2')
  } finally {
    await React.act(async () => root.unmount())
  }
})

test('a quiet resting island asks the host to hide its glass, and work brings it back', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const layouts: Array<{ expanded: boolean; quiet: boolean }> = []
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async (command: string, args: { layout: { expanded: boolean; quiet: boolean } }) => {
        if (command === 'companion_set_expanded') layouts.push(args.layout)
      },
    },
  }
  function Host({ quiet }: { quiet: boolean }) {
    useIsland([], { height: 144, quiet })
    return null
  }
  const root = createRoot(document.createElement('div'))
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  try {
    await React.act(async () => {
      root.render(<Host quiet />)
      await settle()
    })
    await React.act(async () => {
      root.render(<Host quiet={false} />)
      await settle()
    })
    expect(layouts.map(({ expanded, quiet }) => ({ expanded, quiet }))).toEqual([
      { expanded: false, quiet: true },
      { expanded: false, quiet: false },
    ])
  } finally {
    await React.act(async () => root.unmount())
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  }
})

test('an untouched focused preview folds after exit, but interaction cancels that fold', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let island!: ReturnType<typeof useIsland>
  function Host() {
    island = useIsland([])
    return null
  }
  const root = createRoot(document.createElement('div'))
  const leaveDelay = () =>
    new Promise((resolve) => setTimeout(resolve, ISLAND_TIMING.hoverLeaveMs + 40))
  try {
    await React.act(async () => root.render(<Host />))
    await React.act(async () => island.dispatch({ type: 'hover' }))
    expect(island.focusComposer).toBe(true)
    await React.act(async () => {
      island.onPointerLeave()
      await leaveDelay()
    })
    expect(island.expanded).toBe(false)
    await React.act(async () => island.dispatch({ type: 'hover' }))
    await React.act(async () => island.onPointerLeave())
    await React.act(async () => island.dispatch({ type: 'interact' }))
    await React.act(leaveDelay)
    expect(island.expanded).toBe(true)
  } finally {
    await React.act(async () => root.unmount())
  }
})
