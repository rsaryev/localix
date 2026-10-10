import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { PublishedMessageContext } from '@localixai/plugin-sdk/ui'
import { bindPluginUiTransport } from '@localixai/plugin-sdk/ui/transport'
import { motionUri, type MotionLibrary, type MotionProject } from '../shared/contract'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const prior = environment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (prior === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT
  else environment.IS_REACT_ACT_ENVIRONMENT = prior
})

const project: MotionProject = {
  id: 'launch',
  title: 'Spring launch',
  path: '.localix/motion/launch',
  width: 1920,
  height: 1080,
  duration: 20,
  scenes: 4,
  style: 'relay',
  view: '/rpc/motion/view/session/launch/sig/',
  updatedAt: new Date().toISOString(),
  revision: 'r1',
  renders: [],
  snapshots: [],
  issues: ['Root composition has no data-duration.'],
  job: {
    kind: 'render',
    state: 'running',
    progress: 42,
    message: 'Encoding frame 252/600',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  },
}

async function mount(library: MotionLibrary, initialId?: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const requests: Array<{ path: string; method: string }> = []
  const unbind = bindPluginUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      requests.push({ path, method: init?.method ?? 'GET' })
      return Response.json(library)
    },
  })
  const publications: Array<PublishedMessageContext | null> = []
  const publish = (context: PublishedMessageContext | null) => {
    publications.push(context)
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (active = true) => (
    <Workspace
      active={active}
      sessionId="session"
      initialId={initialId}
      publishMessageContext={publish}
    />
  )
  await act(async () => {
    root.render(render())
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  return {
    act,
    host,
    requests,
    publications,
    rerender: (active: boolean) => act(async () => root.render(render(active))),
    button: (name: string) =>
      [...host.querySelectorAll('button')].find(
        (item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name,
      ),
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
      unbind()
    },
  }
}

test('an empty library is one quiet action that opens the directions, then their preview', async () => {
  const view = await mount({ projects: [], tooling: { node: 'v22.11.0', ffmpeg: true } })
  try {
    expect(view.host.querySelectorAll('button')).toHaveLength(1)
    await view.act(async () => view.button('New film')!.click())
    expect(view.host.textContent).toContain('Choose a direction')
    expect(view.host.querySelectorAll('[aria-label$=" direction"]')).toHaveLength(11)
    await view.act(async () => view.button('Blackout direction')!.click())
    expect(view.host.textContent).toContain('Back to directions')
    await view.act(async () => {
      view.button('Use direction')!.click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(view.requests.at(-1)).toEqual({
      path: '/rpc/motion/projects?sessionId=session',
      method: 'POST',
    })
    expect(view.host.querySelector('input')).toBeNull()
    expect(view.publications.at(-1) ?? null).toBeNull()
  } finally {
    await view.cleanup()
  }
})

test('an open film shows job progress, issues and disables tool actions without Node and FFmpeg', async () => {
  const view = await mount(
    { projects: [project], tooling: { node: null, ffmpeg: false } },
    'launch',
  )
  try {
    const progress = view.host.querySelector('[role="progressbar"]')!
    expect(progress.getAttribute('aria-valuenow')).toBe('42')
    expect(view.host.textContent).toContain('Encoding frame 252/600')
    expect(view.host.textContent).toContain('1 thing to fix')
    expect(view.host.textContent).toContain('Node.js 22 or newer and FFmpeg')
    expect(view.button('Take snapshots')).toBeUndefined()
    expect(view.button('Render video')!.disabled).toBe(true)
    expect(JSON.stringify(view.publications.at(-1))).toContain(motionUri('launch'))

    await view.act(async () => {
      view.button('Cancel')!.click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(view.requests.at(-1)).toEqual({
      path: '/rpc/motion/projects/launch/cancel?sessionId=session',
      method: 'POST',
    })

    await view.rerender(false)
    expect(view.publications.at(-1)).toBeNull()
  } finally {
    await view.cleanup()
  }
  expect(view.publications.at(-1)).toBeNull()
})

test('with tools installed and no job, Render is available and the film shows its direction', async () => {
  const idle = { ...project, job: null, issues: [] }
  const view = await mount(
    { projects: [idle], tooling: { node: 'v22.11.0', ffmpeg: true } },
    'launch',
  )
  try {
    expect(view.host.querySelector('[role="progressbar"]')).toBeNull()
    expect(view.button('Render video')!.disabled).toBe(false)
    expect(view.host.textContent).toContain('Relay')
  } finally {
    await view.cleanup()
  }
})
