import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Project } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  await teardown()
})

const settle = () => new Promise((done) => setTimeout(done, 10))

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

test('join routes are read again while the picker is open when agents change', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { resourceSync } = await import('@/shared/api/resourceSync')
  const { useJoinRoutes } =
    await import('@/entities/chat/ui/prompt-input/model-select/useJoinRoutes')
  const read = spyOn(backendClient, 'getJoinRoutes').mockResolvedValue({} as never)
  function Picker() {
    useJoinRoutes('session-1', true)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<Picker />)
      await settle()
    })
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => {
      resourceSync.invalidate(['capabilities'])
      await settle()
    })
    expect(read).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    read.mockRestore()
  }
})
