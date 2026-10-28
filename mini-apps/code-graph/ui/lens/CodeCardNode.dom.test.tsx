import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppClipboard } from '@localixai/mini-app-sdk/ui/runtime'
import type { CodeCard } from '../../shared/lens'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('copies source without the gutter and leaves the code outside canvas drag gestures', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Canvas, CanvasProvider } = await import('@localixai/kit/canvas')
  const { CodeCardNode } = await import('./CodeCardNode')
  const card: CodeCard = {
    node: {
      id: 'sym:reading.ts#read',
      kind: 'function',
      name: 'Read',
      path: 'reading.ts',
      parent: 'file:reading.ts',
      line: 3,
      endLine: 5,
      dependents: 0,
      dependencies: 0,
      size: 0,
    },
    outline: [{ id: 'sym:reading.ts#read', name: 'read', kind: 'function' }],
    language: 'typescript',
    startLine: 3,
    lines: ['export function read() {', '  return true', '}'],
    links: [],
    callees: [],
    stale: false,
    truncated: false,
  }
  const write = spyOn(miniAppClipboard, 'writeText').mockResolvedValue(true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <CanvasProvider>
          <Canvas
            label="Test code"
            controls={false}
            nodeTypes={{ code: CodeCardNode }}
            nodes={[
              {
                id: card.node.id,
                type: 'code',
                position: { x: 0, y: 0 },
                width: 500,
                height: 120,
                data: {
                  card,
                  index: 0,
                  next: null,
                  onFollow: () => {},
                  onOpenFile: () => {},
                  onReveal: () => {},
                },
              },
            ]}
            edges={[]}
          />
        </CanvasProvider>,
      ),
    )
    const code = host.querySelector('pre')!
    expect(code.textContent).toBe(card.lines.join('\n'))
    expect(code.className).toContain('select-text')
    expect(code.closest('.nopan.nodrag')).not.toBeNull()
    const copy = host.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!
    await act(async () => copy.click())
    expect(write.mock.calls).toEqual([[card.lines.join('\n')]])
    expect(host.querySelector('[aria-label="Copied code"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    write.mockRestore()
  }
})
