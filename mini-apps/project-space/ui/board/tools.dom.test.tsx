import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useEffect } from 'react'
import { CanvasProvider } from '@localixai/kit/canvas'
import { registerDom } from '@localixai/kit/testing'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { ToolRail } from './ToolRail'
import { useTools } from './useTools'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete environment.IS_REACT_ACT_ENVIRONMENT
})

test('a chosen shape is placed; keyboard tools clear placement presets', async () => {
  let tools!: ReturnType<typeof useTools>
  const writes: (readonly SpaceOp[])[] = []
  function Probe() {
    const value = useTools({
      space: emptySpace(),
      commit: (ops) => writes.push(ops),
      select: () => undefined,
      setEditing: () => undefined,
    })
    // Read by the test once the commit is done, not written while rendering.
    useEffect(() => {
      tools = value
    })
    return null
  }
  const host = document.createElement('div')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <CanvasProvider>
          <Probe />
        </CanvasProvider>,
      ),
    )
    await act(async () => tools.setTool('shape', { kind: 'triangle' }))
    await act(async () => {
      expect(tools.placeAt(200, 200)).toBe(true)
    })
    expect(writes.at(-1)?.[0]).toMatchObject({
      op: 'create',
      type: 'shape',
      props: { kind: 'triangle' },
    })
    expect(tools.tool).toBe('select')
    await act(async () => tools.setTool('shape', { kind: 'star' }))
    await act(async () => {
      tools.onToolKey('s')
    })
    expect(tools.toolProps).toBeUndefined()
    await act(async () => tools.setLocked(true))
    await act(async () => tools.setTool('shape', { kind: 'diamond' }))
    await act(async () => {
      tools.placeAt(200, 200)
    })
    expect(tools.tool).toBe('shape')
    expect(writes.at(-1)?.[0]).toMatchObject({ props: { kind: 'diamond' } })
    await act(async () => tools.setTool('sequence'))
    await act(async () => {
      tools.placeAt(200, 200)
    })
    const placed = applyOps(emptySpace(), writes.at(-1)!, { registry: spaceTypes })
    const diagram = Object.values(placed.space.elements)[0]!
    expect(diagram.x + diagram.w / 2).toBe(200)
    expect(diagram.y + diagram.h / 2).toBe(200)
    const count = writes.length
    await act(async () => tools.onToolKey('p'))
    await act(async () => {
      expect(tools.placeAt(200, 200)).toBe(false)
    })
    expect(writes).toHaveLength(count)
    expect(tools.tool).toBe('pen')
    for (const [key, type] of [
      ['b', 'table'],
      ['m', 'mindmap'],
    ]) {
      await act(async () => tools.onToolKey(key!))
      expect(tools.tool).toBe(type!)
    }
  } finally {
    await act(async () => root.unmount())
  }
})

test('the catalog exposes advanced tools and choosing one arms it and closes the catalog', async () => {
  const chosen: string[] = []
  const noop = () => undefined
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <ToolRail
          sessionId="s"
          tool="select"
          locked={false}
          onTool={(value) => chosen.push(value)}
          onLock={noop}
          onAddFiles={noop}
          undo={noop}
          redo={noop}
          canUndo={false}
          canRedo={false}
          layersOpen={false}
          onLayers={noop}
          onFind={noop}
          onShortcuts={noop}
        />,
      ),
    )
    expect(host.querySelector('[aria-label="Board history"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Code snippet"]')).toBeNull()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="More tools"]')!.click(),
    )
    const catalog = document.querySelector('[aria-label="Board tools catalog"]')!
    expect(catalog).not.toBeNull()
    const code = [...catalog.querySelectorAll<HTMLElement>('[cmdk-item]')].find((item) =>
      item.textContent?.includes('Code snippet'),
    )!
    expect(code).not.toBeUndefined()
    await act(async () => code.click())
    expect(chosen).toEqual(['code'])
    expect(document.querySelector('[aria-label="Board tools catalog"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('the shape menu marks the default kind and arms the chosen variant', async () => {
  const chosen: unknown[][] = []
  const noop = () => undefined
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <ToolRail
          sessionId="s"
          tool="shape"
          locked={false}
          onTool={(tool, props) => chosen.push([tool, props])}
          onLock={noop}
          onAddFiles={noop}
          undo={noop}
          redo={noop}
          canUndo={false}
          canRedo={false}
          layersOpen={false}
          onLayers={noop}
          onFind={noop}
          onShortcuts={noop}
        />,
      ),
    )
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Shape tools"]')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
    )
    // The variants are the kit's `selected` rows: the armed one is the checked radio item.
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(items.find((item) => item.textContent === 'Rounded')?.getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    const triangle = items.find((item) => item.textContent === 'Triangle')!
    expect(triangle).not.toBeUndefined()
    await act(async () => triangle.click())
    expect(chosen).toEqual([['shape', { kind: 'triangle' }]])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
