import { describe, expect, test } from 'bun:test'

import type { FsChange } from '../../fs-watch/watcher'
import { getProjectFileList } from './file-list-cache'
import { rootChangeFanout } from './root-change-fanout'

function fakeLsp() {
  const calls: { root: string; changes: readonly FsChange[] }[] = []
  return {
    calls,
    manager: {
      notifyWatchedFiles: async (root: string, changes: readonly FsChange[]) => {
        calls.push({ root, changes })
      },
    },
  }
}

const emptyIndex = async () => ({ files: [], truncated: false }) as never

describe('rootChangeFanout', () => {
  // A terminal edit or a branch switch never reached the language servers: only the agent's
  // own writes were announced to them.
  test('known changes reach the root’s language servers', () => {
    const lsp = fakeLsp()
    const changes: FsChange[] = [{ path: '/repo/a.ts', type: 'create' }]
    rootChangeFanout(lsp.manager)('/repo', changes)
    expect(lsp.calls).toEqual([{ root: '/repo', changes }])
  })

  test('unknown changes (null) are not guessed at', () => {
    const lsp = fakeLsp()
    rootChangeFanout(lsp.manager)('/repo', null)
    rootChangeFanout(lsp.manager)('/repo', [])
    expect(lsp.calls).toEqual([])
  })

  test('the quick-open file list is dropped either way', async () => {
    let loads = 0
    const load = async () => {
      loads++
      return emptyIndex()
    }
    await getProjectFileList('/fanout-root', false, load)
    rootChangeFanout(undefined)('/fanout-root', null)
    await getProjectFileList('/fanout-root', false, load)
    expect(loads).toBe(2)
  })
})
