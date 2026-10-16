import { afterAll, beforeAll, expect, test } from 'bun:test'
import { useMemo, useState } from 'react'
import type { FileTreeDecorationIndex } from '@localixai/plugin-sdk/ui'
import { registerDom } from '@localixai/kit/testing/dom'

import {
  __resetFileTreeDecorations,
  registerFileTreeDecoration,
  useFileTreeScopeKey,
  useFileTreeDecorations,
} from './fileTreeDecorations'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  __resetFileTreeDecorations()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * `useIndex` is a hook the PLUGIN owns, chosen at runtime, and plugin UI discovery finishes after
 * first paint. A consumer that simply called `contribution?.useIndex(...)` therefore ran zero hooks
 * on its first render and the provider's hooks on its next — a hook-order violation, which React
 * answers by unmounting the tree. In a packaged build that lands as a minified React error at the
 * route boundary, journalled as "Route failed" with nothing in it naming the file tree.
 *
 * The contract is that a runtime-chosen hook may only change with a new component INSTANCE, so the
 * consumer keys itself on the provider's identity. This test holds both halves: the crash is gone,
 * and a provider that arrives late still reaches the tree.
 */
test('a decoration provider registering after first paint remounts rather than reordering hooks', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')

  let renders = 0
  function Tree() {
    // A hook of the consumer's own, ahead of the contributed one: it is the slot a changed hook
    // order would be measured against.
    const [, force] = useState(0)
    void force
    const decorations = useFileTreeDecorations(null)
    renders += 1
    return <span data-testid="tree">{decorations.decorationFor('a/b.ts')?.letter ?? 'plain'}</span>
  }

  function Sidebar() {
    return <Tree key={useFileTreeScopeKey(null)} />
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Sidebar />))
    expect(host.textContent).toBe('plain')
    const beforeRegistration = renders

    // What plugin discovery does, one capability snapshot later.
    await act(async () => {
      registerFileTreeDecoration({
        id: 'test:decorations',
        useIndex: (): FileTreeDecorationIndex => {
          // Hooks of the provider's own — the ones whose sudden appearance was the bug.
          const [badge] = useState('M')
          return useMemo(
            () => ({
              decorationFor: () => ({
                letter: badge,
                label: 'Modified',
                color: 'text-status-info',
              }),
              directoryHasDecorations: () => true,
            }),
            [badge],
          )
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.textContent).toBe('M')
    expect(renders).toBeGreaterThan(beforeRegistration)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

/**
 * The rule above only holds while the tree actually keys itself on the provider, and that is a
 * property of the CALL SITE — no type or runtime check can state it. Pinned here in source, the way
 * the plugins' own structural guards are.
 */
test('the file tree keys its session subtree on the decoration provider', async () => {
  const source = await Bun.file(
    new URL('../../features/inspector/ui/FileTreeSidebar.tsx', import.meta.url),
  ).text()
  expect(source).toContain('const scope = useFileTreeScopeKey(sessionId)')
  expect(source).toContain('<SessionFileTreeSidebar key={scope}')
})
