import { beforeEach, describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'
import { newlyWrittenFiles, resetAgentFileWrites } from './agentFileWrites'

const fileChange = (
  id: string,
  status: AgentItem['status'],
  changes: { path: string; kind: 'add' | 'modify' | 'delete' | 'rename'; failed?: boolean }[],
): AgentItem =>
  ({
    id,
    type: 'file_change',
    status,
    toolCallId: `call-${id}`,
    name: 'edit',
    changes,
  }) as unknown as AgentItem

describe('an agent edit reaches the open editor without the file watcher', () => {
  beforeEach(() => resetAgentFileWrites())

  test('a settled edit announces the file it wrote', () => {
    const items = [fileChange('i1', 'completed', [{ path: '/repo/a.ts', kind: 'modify' }])]
    expect(newlyWrittenFiles('m1', items)).toEqual(['/repo/a.ts'])
  })

  test('an edit still streaming announces nothing — its file is not written yet', () => {
    const items = [fileChange('i1', 'running', [{ path: '/repo/a.ts', kind: 'modify' }])]
    expect(newlyWrittenFiles('m1', items)).toEqual([])
    // …and settling later still announces it once.
    items[0] = fileChange('i1', 'completed', [{ path: '/repo/a.ts', kind: 'modify' }])
    expect(newlyWrittenFiles('m1', items)).toEqual(['/repo/a.ts'])
  })

  test('a later snapshot of the same card does not announce it again', () => {
    const items = [fileChange('i1', 'completed', [{ path: '/repo/a.ts', kind: 'modify' }])]
    newlyWrittenFiles('m1', items)
    expect(newlyWrittenFiles('m1', items)).toEqual([])
  })

  test('failed and deleted files are not reloaded; the applied half of a partial patch is', () => {
    const items = [
      fileChange('i1', 'failed', [
        { path: '/repo/applied.ts', kind: 'modify' },
        { path: '/repo/rejected.ts', kind: 'modify', failed: true },
        { path: '/repo/gone.ts', kind: 'delete' },
      ]),
    ]
    expect(newlyWrittenFiles('m1', items)).toEqual(['/repo/applied.ts'])
  })

  test('items that are not file changes are ignored', () => {
    const items = [{ id: 't', type: 'text', status: 'completed', text: 'done' } as AgentItem]
    expect(newlyWrittenFiles('m1', items)).toEqual([])
  })
})
