import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

interface SidebarApi {
  view: { resource: string; filter: string; sort: Record<string, unknown> }
  setFilter: (filter: string) => void
  setResource: (resource: never) => void
  setSort: (sort: never) => void
}

/** Mount `useHook(requested)` and hand back its latest return value plus a rerender. */
async function mountHook(useHook: (requested?: never) => SidebarApi, requested?: string) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  let latest: SidebarApi | null = null
  const report = (api: SidebarApi) => {
    latest = api
  }
  function Probe({ resource }: { resource?: string }) {
    report(useHook(resource as never))
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<Probe resource={requested} />))
  return {
    api: () => latest!,
    act: (fn: () => void) => React.act(async () => fn()),
    rerender: (resource?: string) =>
      React.act(async () => root.render(<Probe resource={resource} />)),
    unmount: () => React.act(async () => root.unmount()),
  }
}

async function sidebars() {
  const { useSidebarView } = await import('./useSidebarView')
  const dockerView = await import('../../docker/ui/model/dockerView')
  const k8sView = await import('../../kubernetes/ui/model/viewState')
  return [
    {
      name: 'docker',
      useHook: ((requested?: never) =>
        useSidebarView(
          dockerView.loadDockerView,
          dockerView.saveDockerView,
          requested,
        )) as unknown as (requested?: never) => SidebarApi,
      load: dockerView.loadDockerView as () => SidebarApi['view'],
      resources: ['containers', 'images'] as const,
    },
    {
      name: 'kubernetes',
      useHook: ((requested?: never) =>
        useSidebarView(k8sView.loadK8sView, k8sView.saveK8sView, requested)) as unknown as (
        requested?: never,
      ) => SidebarApi,
      load: k8sView.loadK8sView as () => SidebarApi['view'],
      resources: ['workloads', 'pods'] as const,
    },
  ]
}

describe('DevOps sidebar view state', () => {
  test('filters, switches resource, sorts per resource and persists every change', async () => {
    for (const { useHook, load, resources } of await sidebars()) {
      const [first, second] = resources
      const hook = await mountHook(useHook, first)
      try {
        expect(hook.api().view.resource).toBe(first)

        await hook.act(() => hook.api().setFilter('web'))
        expect(hook.api().view.filter).toBe('web')
        expect(load().filter).toBe('web')

        // A switch of resource clears the filter — it was written for the other list.
        await hook.act(() => hook.api().setResource(second as never))
        expect(hook.api().view).toMatchObject({ resource: second, filter: '' })
        expect(load().resource).toBe(second)

        // A sort lands on the CURRENT resource only.
        const before = hook.api().view.sort[first]
        const sort = { key: 'name', direction: 'desc' }
        await hook.act(() => hook.api().setSort(sort as never))
        expect(hook.api().view.sort[second]).toEqual(sort)
        expect(hook.api().view.sort[first]).toEqual(before)
        expect(load().sort[second]).toEqual(sort)

        // A requested resource (a deep link) wins, and clears the filter.
        await hook.act(() => hook.api().setFilter('db'))
        await hook.rerender(undefined)
        expect(hook.api().view.filter).toBe('db')
        await hook.rerender(first)
        expect(hook.api().view).toMatchObject({ resource: first, filter: '' })
      } finally {
        await hook.unmount()
      }
    }
  })
})
