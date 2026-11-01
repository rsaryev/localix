import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { tap } from '@/testing/hookProbe'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

/** Mount the action in a router at `path`; report where each delete leaves the person. */
async function mounted(path: string, projectOf: (id: string) => string | null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Route, Routes, useLocation } = await import('react-router')
  const { useDeleteSessionAction } = await import('./useDeleteSessionAction')
  const deleted: string[] = []
  const deleteSession = mock(async (id: string) => {
    deleted.push(id)
  })
  const remove = tap<(id: string) => Promise<void>>()
  const location = tap<string>()
  function Harness() {
    location.put(useLocation().pathname)
    remove.put(useDeleteSessionAction({ activeSessionId: 's1', deleteSession, projectOf }))
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  return {
    deleted,
    where: () => location.value,
    remove: (id: string) => act(async () => remove.value!(id)),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('deleting a chat', () => {
  test('the open chat of a project leaves the person in that project, on a new chat', async () => {
    const page = await mounted('/project/p1/s1', () => 'p1')
    await page.remove('s1')
    expect(page.deleted).toEqual(['s1'])
    expect(page.where()).toBe('/project/p1')
    await page.unmount()
  })

  test('another chat of the list leaves the open one where it is', async () => {
    const page = await mounted('/project/p1/s1', () => 'p1')
    await page.remove('s2')
    expect(page.deleted).toEqual(['s2'])
    expect(page.where()).toBe('/project/p1/s1')
    await page.unmount()
  })
})
