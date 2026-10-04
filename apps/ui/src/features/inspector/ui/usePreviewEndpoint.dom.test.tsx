import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { usePreviewEndpoint, type PreviewEndpoint } from './usePreviewEndpoint'
import { usePreviewStore } from '../model/previewStore'

/**
 * The pane never mounts a STORED address. Both in-process preview servers bind an ephemeral
 * port that dies with the API; the frame waits for the live process to say where the page is
 * now, and asks again whenever it has reason to think the answer changed.
 */

type Resolve = Parameters<typeof usePreviewEndpoint>[0]['resolve']
type OnReconnect = Parameters<typeof usePreviewEndpoint>[0]['onReconnect']

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
beforeEach(() => {
  usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
})

const never: OnReconnect = () => () => {}

function Harness({
  onState,
  resolve,
  onReconnect = never,
  stopped = false,
  url = 'http://localhost:8000/',
  rootDir,
  servedFile,
}: {
  onState: (state: PreviewEndpoint) => void
  resolve: Resolve
  onReconnect?: OnReconnect
  stopped?: boolean
  url?: string
  rootDir?: string
  servedFile?: string
}) {
  const endpoint = usePreviewEndpoint({
    active: true,
    url,
    version: 1,
    sessionId: 'session-1',
    rootDir,
    servedFile,
    stopped,
    resolve,
    onReconnect,
  })
  onState(endpoint)
  return null
}

async function mount(element: React.ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(element))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    act,
    rerender: async (next: React.ReactElement) => {
      await act(async () => root.render(next))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    unmount: () => act(async () => root.unmount()),
  }
}

test('the frame is withheld until the live process has answered, then carries its proxy', async () => {
  const seen: PreviewEndpoint[] = []
  let answer: (() => void) | null = null
  const resolve: Resolve = () =>
    new Promise((done) => {
      answer = () =>
        done({
          url: 'http://localhost:8000/',
          previewId: 'http://localhost:8000',
          injectUrl: 'http://localhost:61001/',
        })
    })
  const r = await mount(<Harness onState={(s) => seen.push(s)} resolve={resolve} />)
  try {
    expect(seen.at(-1)?.ready).toBe(false)
    expect(seen.at(-1)?.injectUrl).toBeUndefined()
    await r.act(async () => {
      answer!()
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(seen.at(-1)?.ready).toBe(true)
    expect(seen.at(-1)?.injectUrl).toBe('http://localhost:61001/')
    expect(seen.at(-1)?.epoch).toBe(1)
  } finally {
    await r.unmount()
  }
})

test('a reconnect re-asks: the old process took its ports with it', async () => {
  let port = 61001
  let calls = 0
  const resolve: Resolve = async () => {
    calls += 1
    return {
      url: 'http://localhost:8000/',
      previewId: 'http://localhost:8000',
      injectUrl: `http://localhost:${port}/`,
    }
  }
  let fireReconnect: (() => void) | null = null
  const onReconnect: OnReconnect = (handler) => {
    fireReconnect = handler
    return () => {}
  }
  const seen: PreviewEndpoint[] = []
  const r = await mount(
    <Harness onState={(s) => seen.push(s)} resolve={resolve} onReconnect={onReconnect} />,
  )
  try {
    expect(calls).toBe(1)
    port = 61002
    await r.act(async () => {
      fireReconnect!()
      await new Promise((done) => setTimeout(done, 0))
    })
    expect(calls).toBe(2)
    expect(seen.at(-1)?.injectUrl).toBe('http://localhost:61002/')
    // A new port is a new frame.
    expect(seen.at(-1)?.epoch).toBe(2)
  } finally {
    await r.unmount()
  }
})

test('a served file that went dark is re-served on its own and the entry re-pointed', async () => {
  usePreviewStore.getState().recordPreview('session-1', {
    previewId: 'http://localhost:50001',
    url: 'http://localhost:50001/index.html',
    version: 1,
    rootDir: '/work',
    servedFile: 'index.html',
  })
  let calls = 0
  const resolve: Resolve = async () => {
    calls += 1
    return { url: 'http://localhost:50002/index.html', previewId: 'http://localhost:50002' }
  }
  const props = {
    onState: () => {},
    resolve,
    url: 'http://localhost:50001/index.html',
    rootDir: '/work',
    servedFile: 'index.html',
  }
  const r = await mount(<Harness {...props} />)
  try {
    // The mount itself already re-pointed (the stored port was dead in a new process).
    expect(usePreviewStore.getState().previewBySession['session-1']?.url).toBe(
      'http://localhost:50002/index.html',
    )
    const before = calls
    await r.rerender(<Harness {...props} stopped />)
    expect(calls).toBe(before + 1)
    // Held down: no loop on the flag, only on its flip.
    await r.rerender(<Harness {...props} stopped />)
    expect(calls).toBe(before + 1)
  } finally {
    await r.unmount()
  }
})

/**
 * A failed re-serve used to be swallowed (`.catch(() => setStarting(false))`): a preview whose
 * file had moved read as "the button does nothing". The API knows the cause; it must reach the
 * pane as a report, with the API's own words kept whole.
 */
test('a failed re-serve surfaces the reason instead of failing silently', async () => {
  const resolve: Resolve = async () => {
    throw new Error('No such file to serve: index.html in /work')
  }
  const seen: PreviewEndpoint[] = []
  const r = await mount(
    <Harness
      onState={(s) => seen.push(s)}
      resolve={resolve}
      url="http://localhost:50001/index.html"
      rootDir="/work"
      servedFile="index.html"
    />,
  )
  try {
    const last = seen.at(-1)!
    expect(last.ready).toBe(false)
    expect(last.resolving).toBe(false)
    expect(last.problem?.report.problems[0]?.message).toBe('Could not re-serve this preview file.')
    expect(last.problem?.report.problems[0]?.detail).toContain('index.html')
  } finally {
    await r.unmount()
  }
})
