import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type { ActionContext, ActionContribution } from '@localixai/mini-app-sdk/ui'
import { createSpaceRoutes } from '../backend/routes'
import { registerUi } from './register'
import { isAddedFocus } from './camera/useAddedFocus'
import { ROUTE_PATH, SPACE_KIND } from '../shared/resource'
import { spaceApi } from './api'
import { prepareFragmentId } from './fragmentIdentity'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const picture: ActionContext = {
  surface: 'chat.content',
  target: {
    kind: 'visualization',
    title: 'Order flow',
    format: 'mermaid',
    source: 'sequenceDiagram\nA->>B: Submit\nalt Valid\nB-->>A: Done\nend',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400"><text>Order</text></svg>',
    width: 1600,
    height: 400,
  },
  sessionId: 'origin-chat',
}

test('the contributed action keeps editable Mermaid source on the originating project, with undo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-visualization-'))
  roots.push(root)
  const routes = createSpaceRoutes()
  const requests: string[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      requests.push(path)
      expect(new URL(path, 'http://test').searchParams.get('sessionId')).toBe('origin-chat')
      return routes.request(path.slice(ROUTE_PATH.length), init, {
        userId: 'u',
        projectId: 'p',
        sessionId: 'origin-chat',
        cwd: root,
      })
    },
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  try {
    const { host, registrations } = recordingMiniAppUiHost()
    registerUi(host)
    const action = registrations.actions[0] as ActionContribution
    expect(action.id).toBe('project-space:add-content')
    expect(await action.run(picture)).toEqual({ message: 'Added to Project Space' })
    const view = await (
      await routes.request(
        '/space',
        {},
        { userId: 'u', projectId: 'p', sessionId: 'origin-chat', cwd: root },
      )
    ).json()
    const image = Object.values(view.space.elements)[0] as {
      type: string
      props: Record<string, string>
      w: number
      h: number
    }
    expect(image.props).toMatchObject({
      source: picture.target.kind === 'visualization' ? picture.target.source : '',
      title: 'Order flow',
    })
    expect(image.type).toBe('mermaid')
    expect(image.props.path).toBeUndefined()
    expect(image.w).toBe(960)
    expect(image.h).toBe(240)
    expect(open).toHaveBeenCalledWith({
      workKind: SPACE_KIND,
      id: SPACE_KIND,
      title: 'Project Space',
      scope: 'origin-chat',
    })
    // One request: the board's focus on what was added is asked in the UI, not the server.
    expect(requests).toHaveLength(1)
    expect(isAddedFocus(Object.keys(view.space.elements)[0]!)).toBe(true)
    const undone = await (
      await routes.request(
        '/undo',
        { method: 'POST' },
        { userId: 'u', projectId: 'p', sessionId: 'origin-chat', cwd: root },
      )
    ).json()
    expect(undone.space.elements).toEqual({})
  } finally {
    open.mockRestore()
    unbind()
  }
})

test('a refused board placement does not open a destination or report success', async () => {
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) =>
      Response.json(
        path.includes('/files')
          ? { path: 'diagram.svg' }
          : { results: [{ ok: false, error: 'Board is read-only' }] },
      ),
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  try {
    const { host, registrations } = recordingMiniAppUiHost()
    registerUi(host)
    await expect((registrations.actions[0] as ActionContribution).run(picture)).rejects.toThrow(
      'Board is read-only',
    )
    expect(open).not.toHaveBeenCalled()
  } finally {
    open.mockRestore()
    unbind()
  }
})

test('add, delete and re-add the same fragment; live mini app eligibility follows undo and redo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-repeat-'))
  roots.push(root)
  const routes = createSpaceRoutes()
  const context: ActionContext = { ...picture, sessionId: 'repeat-fragment' }
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) =>
      routes.request(path.slice(ROUTE_PATH.length), init, {
        userId: 'u',
        projectId: 'p',
        sessionId: context.sessionId,
        cwd: root,
      }),
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  try {
    const { host, registrations } = recordingMiniAppUiHost()
    registerUi(host)
    const action = registrations.actions[0] as ActionContribution
    const id = await prepareFragmentId(context.target)
    await spaceApi.space(context.sessionId)
    expect(action.when(context)).toBe(true)
    await action.run(context)
    expect(action.when(context)).toBe(false)
    await spaceApi.apply(context.sessionId, [{ op: 'delete', id }])
    expect(action.when(context)).toBe(true)
    await Promise.all([action.run(context), action.run(context)])
    expect(action.when(context)).toBe(false)
    expect(Object.keys((await spaceApi.space(context.sessionId)).space.elements)).toEqual([id])
    await spaceApi.undo(context.sessionId)
    expect(action.when(context)).toBe(true)
    await spaceApi.redo(context.sessionId)
    expect(action.when(context)).toBe(false)
  } finally {
    open.mockRestore()
    unbind()
  }
})

test('a lost save response is reconciled by its fragment id without repeating the write', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-lost-answer-'))
  roots.push(root)
  const routes = createSpaceRoutes()
  let writes = 0
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const response = await routes.request(path.slice(ROUTE_PATH.length), init, {
        userId: 'u',
        projectId: 'p',
        sessionId: 'lost-answer',
        cwd: root,
      })
      if (path.includes('/ops?')) {
        writes++
        throw new Error('connection lost after save')
      }
      return response
    },
  })
  const open = spyOn(miniAppWorkspace, 'openWorkItem').mockImplementation(() => {})
  try {
    const { host, registrations } = recordingMiniAppUiHost()
    registerUi(host)
    const action = registrations.actions[0] as ActionContribution
    const context = { ...picture, sessionId: 'lost-answer' }
    expect(await action.run(context)).toEqual({ message: 'Added to Project Space' })
    expect(writes).toBe(1)
    expect(action.when(context)).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    expect(Object.keys((await spaceApi.space('lost-answer')).space.elements)).toHaveLength(1)
  } finally {
    open.mockRestore()
    unbind()
  }
})
