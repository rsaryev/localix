import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { inspector } from '@/shared/lib/inspectorBus'
import {
  compareTwoFiles,
  selectedComparePathForSession,
  useCompareSelection,
} from './compareSelection'

afterEach(() => {
  useCompareSelection.getState().clear()
})

describe('compare selection ownership', () => {
  test('exposes a selected path only to its owning session', () => {
    useCompareSelection.getState().selectForCompare('session-a', '/workspace/shared.ts')
    const state = useCompareSelection.getState()

    expect(
      selectedComparePathForSession(state.selectedSessionId, state.selectedPath, 'session-a'),
    ).toBe('/workspace/shared.ts')
    expect(
      selectedComparePathForSession(state.selectedSessionId, state.selectedPath, 'session-b'),
    ).toBeNull()
  })

  test('does not open a completed comparison after the active session changes', async () => {
    let current = true
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const read = spyOn(backendClient, 'getFileContent').mockImplementation(
      async (_sessionId, path) => {
        await gate
        return {
          path,
          content: path,
          bytes: path.length,
          truncated: false,
          hash: `hash:${path}`,
        }
      },
    )
    const open = spyOn(inspector, 'openDiff')

    try {
      const comparing = compareTwoFiles(
        'session-a',
        '/workspace/a.ts',
        '/workspace/b.ts',
        () => current,
      )
      current = false
      finish()
      await comparing

      expect(open).not.toHaveBeenCalled()
    } finally {
      open.mockRestore()
      read.mockRestore()
    }
  })
})
