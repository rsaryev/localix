import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '../chat'
import { extractFileOperations } from './file-ops'
import { namedTool } from './_test-helpers'

const run = (...items: ReturnType<typeof namedTool>[]): ChatMessage[] => [
  { id: 'a0', role: 'assistant', content: 'working', items },
]

describe('extractFileOperations', () => {
  test('a batched read lists every file it read, not just the first', () => {
    const ops = extractFileOperations(
      run(namedTool('read', { path: 'src/a.ts', reads: [{ path: 'src/b.ts' }, 'src/c.ts'] })),
    )
    expect(ops.read).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('a file of the batch that was later changed is listed as modified only', () => {
    const ops = extractFileOperations(
      run(
        namedTool('read', { reads: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] }),
        namedTool('write', { path: 'src/b.ts', content: 'x' }),
      ),
    )
    expect(ops.read).toEqual(['src/a.ts'])
    expect(ops.modified).toEqual(['src/b.ts'])
  })
})
