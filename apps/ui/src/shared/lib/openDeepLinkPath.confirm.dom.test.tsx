import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { scopePath } from '@/shared/routing/routes'

type Project = Awaited<ReturnType<typeof backendClient.listProjects>>[number]
type Resolved = Awaited<ReturnType<typeof backendClient.resolveProjectByPath>>

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(async () => {
  const { resetConfirmationsForTests } = await import('./confirmAction')
  resetConfirmationsForTests()
})

/** Mount the app's one confirmation host and stub the three project calls an open makes. */
async function setup(options: {
  inspected: { kind: 'directory'; path: string; broad?: boolean }
  projects?: Partial<Project>[]
}) {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ActionConfirm } = await import('@/shared/ui/ActionConfirm')
  const resolved: string[] = []
  const spies = [
    spyOn(backendClient, 'inspectPath').mockResolvedValue(options.inspected),
    spyOn(backendClient, 'listProjects').mockResolvedValue((options.projects ?? []) as Project[]),
    spyOn(backendClient, 'resolveProjectByPath').mockImplementation(async (path) => {
      resolved.push(path)
      return { project: { id: 'opened' }, filePath: null, created: true } as unknown as Resolved
    }),
  ]
  const previousHash = window.location.hash
  window.location.hash = '#/'
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(ActionConfirm)))
  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label)
  return {
    act,
    resolved,
    button,
    dialogText: () => document.querySelector('[role="alertdialog"], [role="dialog"]')?.textContent,
    async cleanup() {
      await act(async () => root.unmount())
      container.remove()
      for (const spy of spies) spy.mockRestore()
      window.location.hash = previousHash
    },
  }
}

test('a deep link to an unknown folder asks before it creates or activates a project', async () => {
  const { openDeepLinkPath } = await import('./openDeepLinkPath')
  const env = await setup({ inspected: { kind: 'directory', path: '/work/demo', broad: false } })
  try {
    let opening = openDeepLinkPath('/work/demo')
    await env.act(async () => {})
    expect(env.resolved).toEqual([])
    expect(env.dialogText()).toContain('/work/demo')
    await env.act(async () => env.button('Cancel')?.click())
    await opening
    expect(env.resolved).toEqual([])
    expect(window.location.hash).toBe('#/')

    opening = openDeepLinkPath('/work/demo')
    await env.act(async () => {})
    await env.act(async () => env.button('Open as project')?.click())
    await opening
    expect(env.resolved).toEqual(['/work/demo'])
    expect(window.location.hash).toBe(`#${scopePath('opened')}`)
  } finally {
    await env.cleanup()
  }
})

test('a folder that is already an active project opens without a question', async () => {
  const { openDeepLinkPath } = await import('./openDeepLinkPath')
  const env = await setup({
    inspected: { kind: 'directory', path: '/work/known', broad: false },
    projects: [{ id: 'known', workingDir: '/work/known/' }],
  })
  try {
    await env.act(async () => openDeepLinkPath('/work/known'))
    expect(env.dialogText()).toBeUndefined()
    expect(env.resolved).toEqual(['/work/known'])
  } finally {
    await env.cleanup()
  }
})

test('a filesystem root or the home folder is refused without asking', async () => {
  const { openDeepLinkPath } = await import('./openDeepLinkPath')
  for (const inspected of [
    { kind: 'directory' as const, path: '/', broad: true },
    { kind: 'directory' as const, path: 'C:\\' },
    { kind: 'directory' as const, path: '/home/dummy', broad: true },
  ]) {
    const env = await setup({ inspected, projects: [{ id: 'p', workingDir: inspected.path }] })
    try {
      await env.act(async () => openDeepLinkPath(inspected.path))
      expect(env.dialogText()).toBeUndefined()
      expect(env.resolved).toEqual([])
      expect(window.location.hash).toBe('#/')
    } finally {
      await env.cleanup()
    }
  }
})
