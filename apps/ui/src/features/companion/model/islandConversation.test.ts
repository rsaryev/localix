import { describe, expect, mock, test } from 'bun:test'
import { ApiError } from '@/shared/api/failure'
import { inDeadProject, landIn, restoreOrLand } from './islandConversation'

const missingSession = () => new ApiError('Session not found', 404, 'session_not_found')
const missingProject = () => new ApiError('Project not found', 404, 'project_not_found')

function ports(over: Partial<Parameters<typeof restoreOrLand<string>>[1]> = {}) {
  return {
    find: mock((_id: string): string | null => null),
    fetch: mock(async (id: string) => id),
    land: mock(async (projectId: string | null) => `landed:${projectId ?? 'default'}`),
    forget: mock((_id: string) => {}),
    ...over,
  }
}

describe('island conversation', () => {
  test('a deleted remembered conversation is forgotten and the island lands on a valid one', async () => {
    const io = ports({
      fetch: mock(async () => {
        throw missingSession()
      }),
    })
    expect(await restoreOrLand('LOCALIX-17', io)).toEqual({
      session: 'landed:default',
      restored: false,
    })
    expect(io.forget).toHaveBeenCalledWith('LOCALIX-17')
    expect(io.land).toHaveBeenCalledTimes(1)
  })

  test('a live remembered conversation is restored without landing', async () => {
    const io = ports()
    expect(await restoreOrLand('LOCALIX-3', io)).toEqual({ session: 'LOCALIX-3', restored: true })
    expect(io.land).not.toHaveBeenCalled()
    expect(io.forget).not.toHaveBeenCalled()
  })

  test('an already loaded conversation is not fetched again', async () => {
    const io = ports({ find: mock(() => 'cached') })
    expect(await restoreOrLand('LOCALIX-3', io)).toEqual({ session: 'cached', restored: true })
    expect(io.fetch).not.toHaveBeenCalled()
  })

  test('a transport failure is reported, never mistaken for a deleted conversation', async () => {
    const io = ports({
      fetch: mock(async () => {
        throw new ApiError('offline', 0, 'network')
      }),
    })
    await expect(restoreOrLand('LOCALIX-3', io)).rejects.toThrow('offline')
    expect(io.forget).not.toHaveBeenCalled()
    expect(io.land).not.toHaveBeenCalled()
  })

  test('nothing remembered lands directly', async () => {
    const io = ports()
    expect((await restoreOrLand(null, io)).session).toBe('landed:default')
    expect(io.fetch).not.toHaveBeenCalled()
  })

  test('a deleted folder falls back to the default project', async () => {
    const create = mock(async (projectId: string | null) => {
      if (projectId) throw missingProject()
      return 'default-chat'
    })
    expect(await landIn('gone-project', create)).toBe('default-chat')
    expect(create.mock.calls.map(([id]) => id)).toEqual(['gone-project', null])
  })

  test('other start failures still surface', async () => {
    const create = mock(async () => {
      throw new ApiError('boom', 500, 'internal')
    })
    await expect(landIn('project', create)).rejects.toThrow('boom')
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('dead project', () => {
  test('only a loaded roster without the folder counts as dead', () => {
    expect(inDeadProject(null, 'p1')).toBe(false)
    expect(inDeadProject([{ id: 'p1' }], 'p1')).toBe(false)
    expect(inDeadProject([{ id: 'p2' }], 'p1')).toBe(true)
    expect(inDeadProject([], null)).toBe(false)
  })
})
