import { expect, test } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import { touchedFilesOf } from './touched-files'

// memory.md: a subdirectory's CLAUDE.md and a path-scoped rule load "once Claude reads, writes, or
// edits another file in that subdirectory"; skills.md: `paths` activates a skill "when working with
// files matching the patterns". The files a session has worked with are its file tools' paths.
const message = (items: unknown[]): PersistedMessage =>
  ({
    id: 'm',
    sessionId: 's',
    userId: 'u',
    payload: { id: 'm', role: 'assistant', items },
  }) as never

test('the files a session read, wrote or edited, resolved against its folder', () => {
  const history = [
    message([
      { type: 'tool_call', toolCallId: '1', name: 'Read', input: { path: 'apps/web/src/a.tsx' } },
      { type: 'tool_call', toolCallId: '2', name: 'Read', input: { paths: ['b.md', '/abs/c.ts'] } },
      { type: 'tool_call', toolCallId: '3', name: 'Search', input: { path: 'ignored' } },
      {
        type: 'file_change',
        toolCallId: '4',
        name: 'Edit',
        changes: [{ path: 'lib/d.ts', kind: 'modify' }],
      },
      { type: 'tool_call', toolCallId: '5', name: 'Write', input: { files: [{ path: 'e.txt' }] } },
    ]),
  ]
  expect(touchedFilesOf(history, '/repo')).toEqual([
    '/repo/apps/web/src/a.tsx',
    '/repo/b.md',
    '/abs/c.ts',
    '/repo/lib/d.ts',
    '/repo/e.txt',
  ])
})
