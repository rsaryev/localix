import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { miniAppRealtime, miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { WorkItemVisibilityProvider } from '@localixai/mini-app-sdk/ui/visibility'
import { emptySpace } from '../shared/format/document'
import type { SpaceView } from '../shared/api'
import { applyOps } from '../shared/ops/apply'
import { spaceTypes } from '../shared/types'
import { useSpace, type SpaceState } from './useSpace'
import { spaceApi } from './api'
import { addContentToSpace } from './content-action'
import { needsContent, subscribeContent } from './contentEligibility'
import { prepareFragmentId } from './fragmentIdentity'
import { SPACE_FRAME_TAG, SPACE_SUBSCRIBE, SPACE_UNSUBSCRIBE } from '../shared/resource'
import { savedSpaceView, watchSpaceUpdates } from './spaceUpdates'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

function view(revision = 'empty'): SpaceView {
  return {
    space: emptySpace(),
    revision,
    issues: [],
    writable: true,
    canUndo: false,
    canRedo: false,
    missing: [],
    stamps: {},
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function mount(sessionId: string) {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let state!: SpaceState
  function Probe({ id }: { id: string }) {
    const value = useSpace(id)
    // Read by the test once the commit is done, not written while rendering.
    useEffect(() => {
      state = value
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  const render = (id: string) =>
    act(async () => {
      root.render(
        <WorkItemVisibilityProvider visible={false}>
          <Probe id={id} />
        </WorkItemVisibilityProvider>,
      )
    })
  await render(sessionId)
  return { act, state: () => state, render, close: () => act(async () => root.unmount()) }
}

test('a chat addition reaches an already mounted board immediately; an older poll cannot erase it', async () => {
  const initial = view()
  let saved = initial
  const staleRead = deferred<Response>()
  let reads = 0
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (path.includes('/space?'))
        return ++reads === 1 ? Response.json(initial) : staleRead.promise
      const { ops } = JSON.parse(init!.body as string)
      const applied = applyOps(saved.space, ops, { registry: spaceTypes })
      saved = { ...saved, space: applied.space, revision: 'saved', canUndo: true }
      return Response.json({ ...saved, results: applied.results })
    },
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  const probe = await mount('immediate-add')
  try {
    await probe.act(async () => probe.state().reload())
    let pending!: Promise<void>
    await probe.act(async () => {
      pending = probe.state().reload()
    })
    await probe.act(async () => {
      await addContentToSpace({
        sessionId: 'immediate-add',
        surface: 'chat.content',
        target: { kind: 'markdown', block: 'paragraph', markdown: '**Kept** exactly.' },
      })
    })
    expect(Object.values(probe.state().view!.space.elements)[0]!.props.text).toBe(
      '**Kept** exactly.',
    )
    expect(probe.state().remote).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
    await probe.act(async () => {
      staleRead.resolve(Response.json(initial))
      await pending
    })
    expect(probe.state().view!.revision).toBe('saved')
    expect(Object.keys(probe.state().view!.space.elements)).toHaveLength(1)
    // The destination of a new add also starts with the saved response, without another read.
    const reopened = await mount('immediate-add')
    try {
      expect(reopened.state().view!.revision).toBe('saved')
    } finally {
      await reopened.close()
    }
    expect(reads).toBe(2)
  } finally {
    await probe.close()
    open.mockRestore()
    unbind()
  }
})

test('a poll that started during a write is discarded even if it finishes after the write', async () => {
  const initial = view()
  const write = deferred<Response>()
  const staleRead = deferred<Response>()
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) => (path.includes('/ops?') ? write.promise : staleRead.promise),
  })
  const probe = await mount('poll-during-write')
  try {
    const saving = spaceApi.apply('poll-during-write', [])
    let reading!: Promise<void>
    await probe.act(async () => {
      reading = probe.state().reload()
    })
    await probe.act(async () => {
      write.resolve(Response.json({ ...initial, revision: 'new', results: [] }))
      await saving
    })
    await probe.act(async () => {
      staleRead.resolve(Response.json(initial))
      await reading
    })
    expect(probe.state().view!.revision).toBe('new')
  } finally {
    await probe.close()
    unbind()
  }
})

test('late reads cannot change the board after switching sessions', async () => {
  const old = deferred<Response>()
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) =>
      path.includes('sessionId=old-session') ? old.promise : Response.json(view('new-session')),
  })
  const probe = await mount('old-session')
  try {
    let reading!: Promise<void>
    await probe.act(async () => {
      reading = probe.state().reload()
    })
    await probe.render('new-session')
    expect(probe.state().view).toBeNull()
    await probe.act(async () => probe.state().reload())
    await probe.act(async () => {
      old.resolve(Response.json(view('old-session')))
      await reading
    })
    expect(probe.state().view!.revision).toBe('new-session')
  } finally {
    await probe.close()
    unbind()
  }
})

test('rapid optimistic edits compose before React renders, and saves stay in order', async () => {
  let saved = view()
  const first = deferred<void>()
  const calls: string[] = []
  const unbindUi = bindMiniAppUiTestDoubles()
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (path.includes('/space?')) return Response.json(saved)
      const { ops } = JSON.parse(init!.body as string)
      calls.push(ops[0].id)
      if (calls.length === 1) await first.promise
      const applied = applyOps(saved.space, ops, { registry: spaceTypes })
      saved = { ...saved, space: applied.space, revision: `saved-${calls.length}` }
      return Response.json({ ...saved, results: applied.results })
    },
  })
  const probe = await mount('rapid-edits')
  try {
    await probe.act(async () => probe.state().reload())
    let edits!: Promise<unknown[]>
    await probe.act(async () => {
      edits = Promise.all([
        probe.state().apply([{ op: 'create', type: 'note', id: 'a' }]),
        probe.state().apply([{ op: 'create', type: 'note', id: 'b' }]),
      ])
    })
    expect(Object.keys(probe.state().view!.space.elements).sort()).toEqual(['a', 'b'])
    expect(calls).toEqual(['a'])
    await probe.act(async () => {
      first.resolve()
      await edits
    })
    expect(calls).toEqual(['a', 'b'])
    expect(Object.keys(probe.state().view!.space.elements).sort()).toEqual(['a', 'b'])
    expect(probe.state().view!.revision).toBe('saved-2')
  } finally {
    await probe.close()
    unbind()
    unbindUi()
  }
})

test('many fragment buttons share a read and socket subscription; deletion restores eligibility', async () => {
  const context = {
    sessionId: 'shared-eligibility',
    surface: 'chat.content',
    target: { kind: 'code' as const, text: 'existing source', language: 'ts' },
  }
  const id = await prepareFragmentId(context.target)
  let saved = view('legacy-copy')
  saved.liveUpdates = true
  saved.space = applyOps(
    saved.space,
    [
      {
        op: 'create',
        type: 'code',
        id: 'legacy',
        props: { code: context.target.text, language: 'ts' },
      },
    ],
    { registry: spaceTypes },
  ).space
  let reads = 0
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const commands: Record<string, unknown>[] = []
  const frameSpy = spyOn(miniAppRealtime, 'onFrame').mockImplementation((tag, callback) => {
    expect(tag).toBe(SPACE_FRAME_TAG)
    frames.add(callback)
    return () => {
      frames.delete(callback)
    }
  })
  const reconnectSpy = spyOn(miniAppRealtime, 'onReconnect').mockImplementation((callback) => {
    reconnects.add(callback)
    return () => {
      reconnects.delete(callback)
    }
  })
  const requestSpy = spyOn(miniAppRealtime, 'request').mockImplementation(
    async <T,>(payload: Record<string, unknown>): Promise<T> => {
      commands.push(payload)
      return {} as T
    },
  )
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (path.includes('/space?')) {
        reads++
        return Response.json(saved)
      }
      for (const frame of frames)
        frame(JSON.stringify({ sessionId: context.sessionId, revision: 'own-save' }))
      const { ops } = JSON.parse(init!.body as string)
      const applied = applyOps(saved.space, ops, { registry: spaceTypes })
      saved = { ...saved, space: applied.space, revision: 'own-save' }
      return Response.json({ ...saved, results: applied.results })
    },
  })
  const releases: Array<() => void> = []
  try {
    for (let index = 0; index < 30; index++) releases.push(subscribeContent(context, () => {}))
    await spaceApi.space(context.sessionId)
    expect(reads).toBe(1)
    expect(commands).toEqual([{ t: SPACE_SUBSCRIBE, sessionId: context.sessionId }])
    expect(needsContent(context), 'a legacy copy without a stable id still hides the action').toBe(
      false,
    )
    saved = view('removed')
    saved.liveUpdates = true
    for (const frame of frames)
      frame(JSON.stringify({ sessionId: context.sessionId, revision: saved.revision }))
    await spaceApi.space(context.sessionId)
    expect(reads).toBe(2)
    expect(Boolean(needsContent(context))).toBe(true)
    await spaceApi.apply(context.sessionId, [
      { op: 'create', type: 'code', id, props: { code: context.target.text, language: 'ts' } },
    ])
    expect(
      reads,
      'the socket echo must not refetch a write whose response already supplies the board',
    ).toBe(2)
    expect(needsContent(context)).toBe(false)
    for (const reconnect of reconnects) reconnect()
    await spaceApi.space(context.sessionId)
    expect(reads).toBe(3)
    for (const release of releases.splice(0)) release()
    expect(commands.at(-1)).toEqual({ t: SPACE_UNSUBSCRIBE, sessionId: context.sessionId })
    expect(frames.size).toBe(0)
    expect(reconnects.size).toBe(0)
  } finally {
    for (const release of releases) release()
    unbind()
    requestSpy.mockRestore()
    frameSpy.mockRestore()
    reconnectSpy.mockRestore()
  }
})

test('HTTP must advertise a live backend before any subscription, including after a failed read', async () => {
  const sessionId = 'capability-handshake'
  const commands: Record<string, unknown>[] = []
  const requestSpy = spyOn(miniAppRealtime, 'request').mockImplementation(
    async <T,>(payload: Record<string, unknown>): Promise<T> => {
      commands.push(payload)
      return {} as T
    },
  )
  const frameSpy = spyOn(miniAppRealtime, 'onFrame').mockImplementation(() => () => {})
  const reconnectSpy = spyOn(miniAppRealtime, 'onReconnect').mockImplementation(() => () => {})
  let status = 404
  let saved = view()
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async () => Response.json(saved, { status }),
  })
  const release = watchSpaceUpdates(sessionId, () => {})
  try {
    await expect(spaceApi.space(sessionId)).rejects.toThrow()
    expect(commands).toEqual([])
    status = 200
    await spaceApi.space(sessionId)
    expect(
      commands,
      'older backends keep HTTP reconciliation without an unsupported WS probe',
    ).toEqual([])
    saved = { ...saved, liveUpdates: true }
    await spaceApi.space(sessionId)
    expect(commands).toEqual([{ t: SPACE_SUBSCRIBE, sessionId }])
    await spaceApi.space(sessionId)
    expect(commands).toHaveLength(1)
    saved = { ...saved, liveUpdates: false }
    await spaceApi.space(sessionId)
    expect(commands.at(-1)).toEqual({ t: SPACE_UNSUBSCRIBE, sessionId })
  } finally {
    release()
    unbind()
    requestSpy.mockRestore()
    frameSpy.mockRestore()
    reconnectSpy.mockRestore()
  }
})

test('recovering a lost save response reads past an older in-flight poll', async () => {
  const sessionId = 'recover-past-poll'
  const old = view('old')
  const poll = deferred<Response>()
  let saved = old
  let reads = 0
  let writes = 0
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (path.includes('/space?')) return ++reads === 1 ? poll.promise : Response.json(saved)
      writes++
      const { ops } = JSON.parse(init!.body as string)
      saved = {
        ...saved,
        space: applyOps(saved.space, ops, { registry: spaceTypes }).space,
        revision: 'saved',
      }
      throw new Error('Connection lost after saving')
    },
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  const reading = spaceApi.space(sessionId)
  try {
    await addContentToSpace({
      sessionId,
      surface: 'chat.content',
      target: { kind: 'code', language: 'ts', text: 'saved despite lost response' },
    })
    expect(reads).toBe(2)
    expect(writes).toBe(1)
    expect(open).toHaveBeenCalledTimes(1)
    poll.resolve(Response.json(old))
    await reading
    expect(savedSpaceView(sessionId)?.revision).toBe('saved')
  } finally {
    poll.resolve(Response.json(old))
    await reading
    open.mockRestore()
    unbind()
  }
})
