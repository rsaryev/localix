import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPatchTool } from './patch'
import type { PatchToolDetails } from './patch-report'

test('reports immutable public snapshots and probes editor buffers before diagnostics', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'localix-patch-progress-'))
  try {
    await writeFile(path.join(cwd, 'updated.txt'), 'old\n')
    await writeFile(path.join(cwd, 'deleted.txt'), 'remove\n')
    const progress: Partial<PatchToolDetails>[] = []
    const events: string[] = []
    const tool = createPatchTool(
      undefined,
      cwd,
      async (paths) => {
        events.push('diagnostics')
        expect(paths).toEqual([path.join(cwd, 'updated.txt'), path.join(cwd, 'added.txt')])
        return 'diagnostic evidence'
      },
      undefined,
      undefined,
      (filePath, diskText, moment) => {
        events.push(`editor:${path.basename(filePath)}`)
        expect(moment).toBe('write')
        expect(diskText).toBe(
          filePath.endsWith('updated.txt')
            ? 'old\n'
            : filePath.endsWith('deleted.txt')
              ? 'remove\n'
              : '',
        )
        return 'editor evidence'
      },
    )
    const result = await tool.execute(
      'progress',
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: updated.txt',
          '-old',
          '+new',
          '*** Delete File: deleted.txt',
          '*** Add File: added.txt',
          '+added',
          '*** Update File: absent.txt',
          '-missing',
          '+replacement',
          '*** End Patch',
        ].join('\n'),
      },
      undefined,
      (details) => {
        progress.push(details)
        events.push(details.status ?? 'missing status')
      },
    )
    expect(result.isError).toBeUndefined()
    const prepared = ['updated.txt', 'deleted.txt', 'added.txt']
    expect(
      progress.map(({ status, appliedFiles, files, additions, deletions, currentFile }) => [
        status,
        appliedFiles,
        files?.map((file) => path.basename(file.path)),
        additions,
        deletions,
        currentFile && path.basename(currentFile),
      ]),
    ).toEqual([
      ['validating', 0, [], 0, 0, undefined],
      ['validating', 0, ['updated.txt'], 1, 1, 'updated.txt'],
      ['validating', 0, prepared, 2, 2, 'added.txt'],
      ['applying', 0, prepared, 2, 2, undefined],
      ['applying', 1, prepared, 2, 2, 'updated.txt'],
      ['applying', 2, prepared, 2, 2, 'deleted.txt'],
      ['applying', 3, prepared, 2, 2, 'added.txt'],
    ])
    expect(events.slice(-4)).toEqual([
      'editor:updated.txt',
      'editor:deleted.txt',
      'editor:added.txt',
      'diagnostics',
    ])
    expect(result.details).toMatchObject({
      appliedFiles: 3,
      failedFiles: 1,
      additions: 2,
      deletions: 2,
    })
    for (const details of [...progress, result.details!]) {
      expect(details.files).toBeDefined()
      for (const file of details.files ?? []) {
        expect(file).not.toHaveProperty('originalPath')
        expect(file).not.toHaveProperty('oldContent')
        expect(file).not.toHaveProperty('newContent')
      }
    }
    expect(result.content.indexOf('diagnostic evidence')).toBeLessThan(
      result.content.indexOf('editor evidence'),
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
