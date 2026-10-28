import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Project } from '@/shared/api/contracts'

// Zero-delay timer turns: the code under test schedules with `setTimeout(..., 0)`.
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  await teardown()
})

test('settings project lists follow the projects topic', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { resourceSync } = await import('@/shared/api/resourceSync')
  const { useSettingsProjects } = await import('./useSettingsProjects')
  let names = ['Alpha']
  const list = spyOn(backendClient, 'listProjects').mockImplementation(async () =>
    names.map((name) => ({ id: name, name }) as Project),
  )
  function Names() {
    return <span>{useSettingsProjects({ report: false }).map((project) => project.name)}</span>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<Names />)
      await settle()
    })
    expect(host.textContent).toBe('Alpha')
    names = ['Alpha', 'Beta']
    await act(async () => {
      resourceSync.invalidate(['projects'])
      await settle()
    })
    expect(host.textContent).toBe('AlphaBeta')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    list.mockRestore()
  }
})
