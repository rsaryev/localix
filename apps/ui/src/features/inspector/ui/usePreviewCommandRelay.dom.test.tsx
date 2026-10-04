import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { usePreviewCommandRelay } from './usePreviewCommandRelay'
import type { VisualFeedbackBridge } from './useVisualFeedback'

let teardown: () => Promise<void>
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let previousAct: boolean | undefined
let sequence = 0
beforeAll(() => {
  teardown = registerDom()
  previousAct = globals.IS_REACT_ACT_ENVIRONMENT
  globals.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  globals.IS_REACT_ACT_ENVIRONMENT = previousAct
  await teardown()
})

function Host(props: Parameters<typeof usePreviewCommandRelay>[0]) {
  usePreviewCommandRelay(props)
  return null
}

async function fixture(
  options: {
    actual?: { width: number; height: number }
    ready?: () => Promise<boolean>
    denied?: boolean
    enabled?: boolean
  } = {},
) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const sessionId = `relay-test-${++sequence}`
  const replies: Record<string, unknown>[] = []
  const sizes: Array<{ width: number; height: number } | null> = []
  const commands: string[] = []
  const reply = spyOn(backendClient, 'previewResult').mockImplementation(async (_id, payload) => {
    replies.push(payload)
    return !options.denied
  })
  const raf = spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    queueMicrotask(() => callback(0))
    return 1
  })
  const vf: Pick<VisualFeedbackBridge, 'connected' | 'whenConnected' | 'runCommand'> = {
    connected: true,
    whenConnected: options.ready ?? (async () => true),
    runCommand: async (_id, command) => {
      commands.push(command.action)
      return {
        ok: true,
        result: {
          action: 'evaluate',
          value: JSON.stringify(options.actual ?? { width: 375, height: 667 }),
        },
      }
    },
  }
  await act(async () =>
    root.render(
      <Host
        sessionId={sessionId}
        previewId="target"
        vf={vf}
        hasInjectUrl={false}
        engaged
        engage={() => {}}
        enabled={options.enabled}
        setViewport={(size) => sizes.push(size)}
      />,
    ),
  )
  return {
    replies,
    sizes,
    commands,
    root,
    send: (viewport: { width: number; height: number } | null, previewId = 'target') =>
      act(async () => {
        previewControlBus.publish({
          sessionId,
          commandId: `${sessionId}-${replies.length}`,
          command: { action: 'viewport', previewId, viewport },
        })
      }),
    cleanup: async () => {
      await act(async () => root.unmount())
      raf.mockRestore()
      reply.mockRestore()
    },
  }
}

test('agent resize uses the host setter and confirms dimensions from the page', async () => {
  const f = await fixture()
  try {
    await f.send({ width: 375, height: 667 })
    expect(f.sizes).toEqual([{ width: 375, height: 667 }])
    expect(f.replies[0]).toMatchObject({ claim: true })
    expect(f.replies.at(-1)).toMatchObject({
      ok: true,
      result: { action: 'viewport', previewId: 'target', viewport: { width: 375, height: 667 } },
    })
    await f.send(null)
    expect(f.sizes.at(-1)).toBeNull()
  } finally {
    await f.cleanup()
  }
})

test('mismatched actual dimensions are a failed check, not a claimed resize', async () => {
  const f = await fixture({ actual: { width: 373, height: 665 } })
  try {
    await f.send({ width: 375, height: 667 })
    expect(f.replies.at(-1)).toMatchObject({
      ok: false,
      errorCode: 'failed',
      result: { viewport: { width: 373, height: 665 } },
    })
  } finally {
    await f.cleanup()
  }
})

test('other previews, hidden hosts and rejected claims do not change dimensions', async () => {
  for (const options of [{}, { enabled: false }, { denied: true }]) {
    const f = await fixture(options)
    try {
      await f.send({ width: 375, height: 667 }, Object.keys(options).length ? 'target' : 'other')
      expect(f.sizes).toEqual([])
      expect(f.commands).toEqual([])
    } finally {
      await f.cleanup()
    }
  }
})

test('a released host hands an unexecuted command to a replacement host', async () => {
  let connect: (ready: boolean) => void = () => {}
  const ready = new Promise<boolean>((resolve) => {
    connect = resolve
  })
  const f = await fixture({ ready: () => ready })
  try {
    await f.send({ width: 375, height: 667 })
    await act(async () => f.root.unmount())
    await act(async () => connect(true))
    expect(f.sizes).toEqual([])
    expect(f.commands).toEqual([])
    expect(f.replies.at(-1)).toMatchObject({ ok: false, release: true })
  } finally {
    await f.cleanup()
  }
})
