import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { createResumeRoutes } from '../backend/routes'
import { createResumeService } from '../backend/service'
import { createTemplateDocument } from '../shared/templates'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorEnvironment = environment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (priorEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT
  else environment.IS_REACT_ACT_ENVIRONMENT = priorEnvironment
})

test('dirty editor survives remote edits, merges independent fields, saves, and recovers unfinished input after remount', async () => {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useResumes } = await import('./useResumes')
  const folder = await mkdtemp(join(tmpdir(), 'resume-editor-'))
  const service = createResumeService(folder)
  const created = await service.create('user', createTemplateDocument('awal', 'CV'))
  const app = new Hono().route('/rpc/resume', createResumeRoutes(createResumeService))
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) =>
      app.request(`http://localhost${path}`, init, {
        userId: 'user',
        sessionId: 'session',
        projectId: '',
        cwd: folder,
      }),
  })
  let hook!: ReturnType<typeof useResumes>
  function Probe() {
    const value = useResumes(true, 'session', created.id)
    useEffect(() => {
      hook = value
    })
    return <p>{value.draft?.header.name}</p>
  }
  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  try {
    await act(async () => root.render(<Probe />))
    await act(async () => hook.refresh())
    expect(hook.base?.id).toBe(created.id)
    await act(async () =>
      hook.setDraft({ ...hook.draft!, header: { ...hook.draft!.header, name: 'User draft' } }),
    )
    expect(hook.dirty).toBe(true)
    const remote = await service.update(
      'user',
      created.id,
      created.revision,
      [{ op: 'metadata', value: { title: 'Agent title' } }],
      'agent',
    )
    await act(async () => hook.refresh())
    expect(hook.draft?.header.name).toBe('User draft')
    expect(hook.base?.revision).toBe(created.revision)
    expect(hook.remoteChanged).toBe(true)
    await act(async () => hook.rebase())
    expect(hook.draft?.title).toBe('Agent title')
    expect(hook.draft?.header.name).toBe('User draft')
    expect(hook.base?.revision).toBe(remote.revision)
    await act(async () => {
      await hook.save()
    })
    expect((await service.get('user', created.id)).document.header.name).toBe('User draft')
    const unfinished = {
      ...hook.draft!,
      header: { ...hook.draft!.header, links: [{ label: 'Portfolio', url: '' }] },
    }
    await act(async () => hook.setDraft(unfinished))
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => hook.refresh())
    expect(hook.recovered).toBe(true)
    expect(hook.draft?.header.links).toEqual([{ label: 'Portfolio', url: '' }])
    expect(hook.dirty).toBe(true)
    await act(async () => hook.discard())
    expect(hook.draft?.header.links).toEqual([])
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
    localStorage.removeItem(`resume.draft.v1.${created.id}`)
    await rm(folder, { recursive: true, force: true })
  }
})

test('same-field conflict never silently chooses a writer and local Undo/Redo survives an unchanged refresh', async () => {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useResumes } = await import('./useResumes')
  const folder = await mkdtemp(join(tmpdir(), 'resume-conflict-'))
  const service = createResumeService(folder)
  const created = await service.create('user', createTemplateDocument('ketik', 'CV'))
  const app = new Hono().route('/rpc/resume', createResumeRoutes(createResumeService))
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) =>
      app.request(`http://localhost${path}`, init, {
        userId: 'user',
        sessionId: 'session',
        projectId: '',
        cwd: folder,
      }),
  })
  let hook!: ReturnType<typeof useResumes>
  function Probe() {
    const value = useResumes(true, 'session', created.id)
    useEffect(() => {
      hook = value
    })
    return <p>{value.draft?.header.name}</p>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Probe />))
    await act(async () => hook.refresh())
    await act(async () =>
      hook.setDraft({ ...hook.draft!, header: { ...hook.draft!.header, name: 'Local name' } }),
    )
    await act(async () => hook.undo())
    expect(hook.draft?.header.name).toBe('')
    await act(async () => hook.refresh())
    expect(hook.canRedo).toBe(true)
    await act(async () => hook.redo())
    await service.update(
      'user',
      created.id,
      created.revision,
      [{ op: 'header', value: { name: 'Agent name' } }],
      'agent',
    )
    await act(async () => hook.refresh())
    await act(async () => hook.rebase())
    expect(hook.error).toContain('header.name')
    expect(hook.draft?.header.name).toBe('Local name')
    expect((await service.get('user', created.id)).document.header.name).toBe('Agent name')
    expect(hook.dirty).toBe(true)
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
    localStorage.removeItem(`resume.draft.v1.${created.id}`)
    await rm(folder, { recursive: true, force: true })
  }
})
