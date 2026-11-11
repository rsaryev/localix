import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { useChatStore } from '@/entities/chat/model/store'
import { isWorkspaceFolderGone, MissingFolderNotice } from './MissingFolderNotice'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(() => mock.restore())

const OLD = '/Users/me/Documents/claude-plugin-kit'
const NEW = '/Users/me/Documents/llx-plugin'

async function render(onResolved: () => void) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  useChatStore.setState({
    allSessions: [{ id: 'gone-1', title: 'kit', projectId: 'PRJ-13' } as unknown as UiSession],
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(<MissingFolderNotice sessionId="gone-1" onResolved={onResolved} />),
  )
  const click = async (name: string) => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))
    if (!button) throw new Error(`no button "${name}" in: ${host.textContent}`)
    await React.act(async () => button.click())
  }
  return { host, click, unmount: () => React.act(() => root.unmount()) }
}

const moved = {
  project: { id: 'PRJ-13' },
  memory: 'copied',
  trust: { before: false, after: false },
}

describe('the Files pane when the project folder is gone', () => {
  test('a workspace_folder_* refusal is told apart from any other failure', () => {
    expect(isWorkspaceFolderGone(new ApiError('gone', 409, 'workspace_folder_missing'))).toBe(true)
    expect(isWorkspaceFolderGone(new ApiError('no', 404, 'session_not_found'))).toBe(false)
    expect(isWorkspaceFolderGone(new Error('x'))).toBe(false)
  })

  test('names the folder and offers the moved one, applied only on a click', async () => {
    spyOn(backendClient, 'projectFolder').mockResolvedValue({
      path: OLD,
      state: 'missing',
      suggestion: NEW,
    })
    const relocate = spyOn(backendClient, 'relocateProject').mockResolvedValue(moved as never)
    const resolved = mock(() => {})
    const view = await render(resolved)
    expect(view.host.textContent).toContain('Project folder not found')
    expect(view.host.textContent).toContain(OLD)
    expect(view.host.textContent).toContain('Locate folder…')
    expect(relocate).not.toHaveBeenCalled()

    await view.click('Use “llx-plugin”')
    expect(relocate).toHaveBeenCalledWith('PRJ-13', NEW)
    expect(resolved).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  test('Locate folder… re-points the project at the picked folder; a cancelled pick does nothing', async () => {
    spyOn(backendClient, 'projectFolder').mockResolvedValue({
      path: OLD,
      state: 'missing',
      suggestion: null,
    })
    const pick = spyOn(backendClient, 'pickDirectory').mockResolvedValue(null)
    const relocate = spyOn(backendClient, 'relocateProject').mockResolvedValue(moved as never)
    const resolved = mock(() => {})
    const view = await render(resolved)
    expect(view.host.textContent).not.toContain('Use “')

    await view.click('Locate folder…')
    expect(relocate).not.toHaveBeenCalled()
    pick.mockResolvedValue(NEW)
    await view.click('Locate folder…')
    expect(relocate).toHaveBeenCalledWith('PRJ-13', NEW)
    expect(resolved).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  test('Try again reloads the tree once the folder is back', async () => {
    const status = spyOn(backendClient, 'projectFolder').mockResolvedValue({
      path: OLD,
      state: 'not_a_directory',
      suggestion: null,
    })
    const resolved = mock(() => {})
    const view = await render(resolved)
    expect(view.host.textContent).toContain('Project folder is now a file')
    expect(resolved).not.toHaveBeenCalled()

    status.mockResolvedValue({ path: OLD, state: 'present', suggestion: null })
    await view.click('Try again')
    expect(resolved).toHaveBeenCalledTimes(1)
    await view.unmount()
  })
})
