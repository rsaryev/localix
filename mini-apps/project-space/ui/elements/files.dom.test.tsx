import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { CanvasProvider } from '@localixai/kit/canvas'
import { registerDom } from '@localixai/kit/testing'
import { viewOf } from './index'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

/**
 * A file card shows the file's text. It once showed a single empty line: the route answered with
 * the text, and the card drew nothing of it.
 */
test('a file card shows the text the route answers with', async () => {
  const requested: string[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) => {
      requested.push(path)
      return new Response(
        JSON.stringify({ text: 'const a = 1\nconst b = 2\n', binary: false, truncated: false }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })
  const View = viewOf('file')!.View
  const host = document.createElement('div')
  document.body.append(host)
  // Loaded here, after registerDom(): react-dom reads the DOM globals when it initializes.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  await act(async () => {
    // A card reads the camera's zoom (far away it drops its body), so it lives in a board.
    root.render(
      <CanvasProvider>
        <View
          id="f1"
          props={{ path: 'src/a.ts' }}
          width={320}
          height={200}
          selected={false}
          editing={false}
          missing={false}
          sessionId="s1"
          stamp={1}
          commit={() => undefined}
          resize={() => undefined}
          stopEditing={() => undefined}
        />
      </CanvasProvider>,
    )
  })
  await act(async () => turns())
  expect(requested[0]).toContain('/rpc/project-space/text?sessionId=s1&path=src%2Fa.ts')
  expect(host.textContent).toContain('const b = 2')
  await act(async () => root.unmount())
  unbind()
})
