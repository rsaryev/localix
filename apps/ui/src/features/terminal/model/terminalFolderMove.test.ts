import { afterEach, expect, test } from 'bun:test'
import type { Project, UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/entities/chat/model/store'
import { projectDirOf, terminalFolderMove } from './terminalFolderMove'

const original = useChatStore.getState()
afterEach(() => useChatStore.setState(original))

/**
 * A terminal keeps the directory it started in. When its project is pointed at the folder it moved
 * to, the shell is still in a path that no longer exists, so the pane says so and restarts there.
 */
test('a terminal started in the project folder moved with it, at the same place inside', () => {
  const started = { cwd: '/work/kit/frontend', projectDir: '/work/kit' }
  expect(terminalFolderMove(started, '/work/llx')).toEqual({
    from: '/work/kit',
    to: '/work/llx',
    cwd: '/work/llx/frontend',
  })
  expect(terminalFolderMove({ ...started, cwd: '/work/kit' }, '/work/llx')?.cwd).toBe('/work/llx')
})

test('nothing moved: the same folder, a terminal elsewhere, or one from before folders were noted', () => {
  expect(terminalFolderMove({ cwd: '/work/kit', projectDir: '/work/kit' }, '/work/kit')).toBeNull()
  // A dev server started in another folder stays where it was started.
  expect(terminalFolderMove({ cwd: '/srv/api', projectDir: '/work/kit' }, '/work/llx')).toBeNull()
  // A sibling sharing the old folder's spelling is not inside it.
  expect(
    terminalFolderMove({ cwd: '/work/kit-old', projectDir: '/work/kit' }, '/work/llx'),
  ).toBeNull()
  expect(terminalFolderMove({ cwd: '/work/kit' }, '/work/llx')).toBeNull()
  expect(terminalFolderMove({ cwd: '/work/kit', projectDir: '/work/kit' }, undefined)).toBeNull()
})

test("a chat's project folder is read from the store", () => {
  useChatStore.setState({
    allSessions: [{ id: 's1', projectId: 'PRJ-1' } as unknown as UiSession],
    projects: [{ id: 'PRJ-1', workingDir: '/work/llx' } as unknown as Project],
  })
  expect(projectDirOf(useChatStore.getState(), 's1')).toBe('/work/llx')
  expect(projectDirOf(useChatStore.getState(), 'nope')).toBeUndefined()
})
