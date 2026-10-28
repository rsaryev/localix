import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useEffect } from 'react'
import { CanvasProvider } from '@localixai/kit/canvas'
import { registerDom } from '@localixai/kit/testing'
import { emptySpace, type SpaceDocument } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import type { CameraDirector } from '../camera/useCameraDirector'
import { usePresentation, type Presentation } from './usePresentation'

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

const frames = (ids: string[]) =>
  applyOps(
    emptySpace(),
    ids.map((id, index) => ({ op: 'create' as const, id, type: 'frame', x: index * 800, y: 0 })),
    { registry: spaceTypes },
  ).space

test('a presentation stays on its frame when others come and go, and ends when its own goes', async () => {
  const glides: unknown[] = []
  const director = {
    size: () => ({ width: 800, height: 600 }),
    glide: async (viewport: unknown) => {
      glides.push(viewport)
      return viewport
    },
  } as unknown as CameraDirector
  let shown: Presentation | undefined
  function Probe({ space }: { space: SpaceDocument }) {
    const presentation = usePresentation(space, director, () => undefined)
    // Read by the test after the commit, not written while rendering.
    useEffect(() => {
      shown = presentation
    })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const render = (space: SpaceDocument) =>
    act(async () =>
      root.render(
        <CanvasProvider>
          <Probe space={space} />
        </CanvasProvider>,
      ),
    )
  try {
    await render(frames(['a', 'b', 'c']))
    await act(async () => shown!.start())
    await act(async () => shown!.go(1))
    expect(shown!.frames[shown!.index]).toBe('b')
    // The agent removes the first frame: the talk is still on "b", now the first slide.
    await render(frames(['b', 'c']))
    expect(shown!.active).toBe(true)
    expect(shown!.frames[shown!.index]).toBe('b')
    expect(shown!.slide?.has('b')).toBe(true)
    // "b" itself goes: the presentation ends instead of showing another frame as this one.
    const glidesBefore = glides.length
    await render(frames(['c']))
    expect(shown!.active).toBe(false)
    // The board comes back to where it was before the talk, exactly once.
    expect(glides.length).toBe(glidesBefore + 1)
    expect(glides.at(-1)).toEqual({ x: 0, y: 0, zoom: 1 })
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
