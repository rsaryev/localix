import { describe, expect, test } from 'bun:test'

import { createSourceControlService } from './service'
import type { SourceControlBackend } from './ports'

describe('commit inline-completion context', () => {
  test('resolves diff, branch, staging mode and recent message style on the server', async () => {
    const backend = {
      id: 'git',
      getCommitDiff: async () => ({
        diff: 'diff --git a/a b/a\n+completion',
        stat: ' a | 1 +',
        staged: true,
      }),
      getStatus: async () => ({
        branch: 'feature/completion',
        files: [
          {
            path: 'a',
            status: 'modified',
            staged: true,
            unstaged: false,
            insertions: 1,
            deletions: 0,
          },
          {
            path: 'not-committed.ts',
            status: 'modified',
            staged: false,
            unstaged: true,
            insertions: 1,
            deletions: 0,
          },
        ],
      }),
      getRecentCommitMessages: async () => ['feat(ui): previous message'],
    } as unknown as SourceControlBackend
    const service = createSourceControlService({
      resolveCwd: async () => '/repo',
      resolveBackend: async () => backend,
    })

    expect(await service.getCommitCompletionContext('u', 's', '/repo')).toEqual({
      branch: 'feature/completion',
      files: [
        {
          path: 'a',
          status: 'modified',
          staged: true,
          unstaged: false,
          insertions: 1,
          deletions: 0,
        },
      ],
      stat: ' a | 1 +',
      diff: 'diff --git a/a b/a\n+completion',
      staged: true,
      recentMessages: ['feat(ui): previous message'],
    })
  })

  test('returns null without a change set', async () => {
    const backend = {
      id: 'git',
      getCommitDiff: async () => ({ diff: '', stat: '', staged: false }),
      getStatus: async () => ({ branch: 'main', files: [] }),
      getRecentCommitMessages: async () => [],
    } as unknown as SourceControlBackend
    const service = createSourceControlService({
      resolveCwd: async () => '/repo',
      resolveBackend: async () => backend,
    })
    expect(await service.getCommitCompletionContext('u', 's')).toBeNull()
  })

  test('keeps inventory-only context for an empty untracked file', async () => {
    const emptyFile = {
      path: 'fixtures/.gitkeep',
      status: 'untracked' as const,
      staged: false,
      unstaged: true,
      insertions: 0,
      deletions: 0,
    }
    const backend = {
      id: 'git',
      getCommitDiff: async () => ({ diff: '', stat: '', staged: false }),
      getStatus: async () => ({ branch: 'main', files: [emptyFile] }),
      getRecentCommitMessages: async () => ['chore: preserve fixture directories'],
    } as unknown as SourceControlBackend
    const service = createSourceControlService({
      resolveCwd: async () => '/repo',
      resolveBackend: async () => backend,
    })

    expect(await service.getCommitCompletionContext('u', 's')).toEqual({
      branch: 'main',
      files: [emptyFile],
      stat: '',
      diff: '',
      staged: false,
      recentMessages: ['chore: preserve fixture directories'],
    })
  })

  test('uses every unstaged and untracked file for the commit-all inventory', async () => {
    const files = [
      {
        path: 'changed.ts',
        status: 'modified' as const,
        staged: false,
        unstaged: true,
        insertions: 2,
        deletions: 1,
      },
      {
        path: 'new.ts',
        status: 'untracked' as const,
        staged: false,
        unstaged: true,
        insertions: 0,
        deletions: 0,
      },
    ]
    const backend = {
      id: 'git',
      getCommitDiff: async () => ({
        diff: 'diff --git a/changed.ts b/changed.ts\n+x',
        stat: ' changed.ts | 1 +',
        staged: false,
      }),
      getStatus: async () => ({ branch: 'main', files }),
      getRecentCommitMessages: async () => [],
    } as unknown as SourceControlBackend
    const service = createSourceControlService({
      resolveCwd: async () => '/repo',
      resolveBackend: async () => backend,
    })

    expect((await service.getCommitCompletionContext('u', 's'))?.files).toEqual(files)
  })
})
