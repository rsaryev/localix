import { expect, test } from 'bun:test'
import { createWorkspaceEditApplicator } from './service-workspace-edit'
import type { OpenDoc } from './service-contract'
import { textDigest } from './lsp-edits'

function document(userId: string, text: string, syncing = Promise.resolve()): OpenDoc {
  return {
    userId,
    text,
    syncing,
    sessionId: 'session',
    projectRoot: '/fixture',
    file: '/fixture/open',
    consumers: new Set(['editor']),
    lastSent: '',
  }
}

const edits = [
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'prefix ',
  },
]

test('workspace edits read later documents after sync and route foreign buffers to disk', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const own = document('owner', 'old', gate)
  const foreign = document('other', 'foreign')
  const calls: unknown[] = []
  const fileEdits = [
    { file: '/fixture/open', edits },
    { file: '/fixture/foreign', edits },
  ]
  const apply = createWorkspaceEditApplicator({
    getOpenDoc: (_session, file) => {
      calls.push(['get', file])
      return file === '/fixture/open' ? own : foreign
    },
    commitWorkspaceEdit: async (user, session, diskEdits) => {
      calls.push(['commit', user, session, diskEdits])
      expect(diskEdits[0]).toBe(fileEdits[1])
      return { changedFiles: ['/fixture/foreign'], files: [] }
    },
  })
  try {
    const pending = apply('owner', 'session', fileEdits)
    expect(calls).toEqual([['get', '/fixture/open']])
    own.text = 'latest'
    release()
    expect(await pending).toEqual({
      changedFiles: ['/fixture/foreign'],
      files: [],
      bufferEdits: [{ file: '/fixture/open', digest: textDigest('latest'), edits }],
    })
    expect(calls).toEqual([
      ['get', '/fixture/open'],
      ['get', '/fixture/foreign'],
      ['commit', 'owner', 'session', [fileEdits[1]]],
    ])
  } finally {
    release()
  }
})

test('a rejected buffer sync still routes against its retained text without a disk write', async () => {
  const own = document('owner', 'retained', Promise.reject(new Error('sync rejected')))
  const apply = createWorkspaceEditApplicator({
    getOpenDoc: () => own,
    commitWorkspaceEdit: async () => {
      throw new Error('unexpected disk write')
    },
  })
  expect(await apply('owner', 'session', [{ file: '/fixture/open', edits }])).toEqual({
    changedFiles: [],
    files: [],
    bufferEdits: [{ file: '/fixture/open', digest: textDigest('retained'), edits }],
  })
})
