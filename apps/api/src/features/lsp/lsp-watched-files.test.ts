import { describe, expect, test } from 'bun:test'

import type { LspClientInfo } from './lsp-protocol'
import type { LspServerStatus } from './lsp-manager-types'
import { notifyWatchedFiles, type LspWatchedFileChange } from './lsp-watched-files'

/** A server record whose client only records what it was told. */
function target(rootDir: string, status: LspServerStatus = 'ready') {
  const received: LspWatchedFileChange[][] = []
  const client = {
    notifyWatchedFiles: async (changes: readonly LspWatchedFileChange[]) => {
      received.push([...changes])
    },
  } as unknown as LspClientInfo
  return { record: { client, status, rootDir }, received }
}

describe('notifyWatchedFiles — fan-out to a root’s servers', () => {
  test('each ready server hears only the changes under its own rootDir', async () => {
    const web = target('/repo/web')
    const api = target('/repo/api')
    await notifyWatchedFiles(
      [web.record, api.record],
      [
        { path: '/repo/web/a.ts', type: 'update' },
        { path: '/repo/api/b.ts', type: 'create' },
        { path: '/repo/web-other/c.ts', type: 'update' }, // a sibling, not under /repo/web
      ],
    )
    expect(web.received).toEqual([[{ path: '/repo/web/a.ts', type: 'update' }]])
    expect(api.received).toEqual([[{ path: '/repo/api/b.ts', type: 'create' }]])
  })

  test('a server still starting is skipped — it reads the disk as it initializes', async () => {
    const starting = target('/repo', 'starting')
    await notifyWatchedFiles([starting.record], [{ path: '/repo/a.ts', type: 'update' }])
    expect(starting.received).toEqual([])
  })

  // A branch switch rewrites `.git/` wholesale; none of it is a source file.
  test('version-control internals never reach a server', async () => {
    const repo = target('/repo')
    await notifyWatchedFiles(
      [repo.record],
      [
        { path: '/repo/.git/HEAD', type: 'update' },
        { path: '/repo/.git', type: 'update' },
      ],
    )
    expect(repo.received).toEqual([])
  })

  // A running build rewrites these trees thousands of files at a time, every flush.
  test('dependency and build-cache trees never reach a server; source beside them does', async () => {
    const repo = target('/repo')
    await notifyWatchedFiles(
      [repo.record],
      [
        { path: '/repo/app/src-tauri/target/debug/deps/a.rlib', type: 'create' },
        { path: '/repo/.turbo/dev-mini-apps/1/mini-apps/x/index.js', type: 'update' },
        { path: '/repo/node_modules/.bin/tsc', type: 'update' },
        { path: '/repo/web/.next/server/page.js', type: 'update' },
        { path: '/repo/src/targets.ts', type: 'update' },
      ],
    )
    expect(repo.received).toEqual([[{ path: '/repo/src/targets.ts', type: 'update' }]])
  })

  test('one failing server does not stop the others', async () => {
    const broken = target('/repo')
    ;(broken.record.client as { notifyWatchedFiles: unknown }).notifyWatchedFiles = async () => {
      throw new Error('pipe closed')
    }
    const healthy = target('/repo')
    await notifyWatchedFiles(
      [broken.record, healthy.record],
      [{ path: '/repo/a.ts', type: 'delete' }],
    )
    expect(healthy.received.length).toBe(1)
  })
})
