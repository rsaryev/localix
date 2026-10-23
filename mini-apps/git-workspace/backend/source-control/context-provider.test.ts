import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { describe, expect, test } from 'bun:test'

import { createGitContextProvider } from './context-provider'
import type { ResourceGitService } from './resource-provider'
import type { ContextResolver } from '@localixai/mini-app-sdk/backend'

let reads = 0
const service: ResourceGitService = {
  listRepoProjects: async () => [{ id: 'p', name: 'repo', cwd: '/workspace/repo', branch: 'main' }],
  resolveRepoCwd: async () => '/workspace/repo',
  listRepos: async (cwd) => [{ relpath: '', name: 'root', cwd }],
  listBranches: async () => [],
  getStatus: async () => ({
    root: '/workspace/repo',
    branch: 'main',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    stats: { files: 0, insertions: 0, deletions: 0 },
  }),
  getLog: async () => [],
  getCommitShow: async () => ({ path: '', diff: '', binary: false }),
  getCommitFiles: async () => [],
  getCommitFileDiff: async () => '',
  getWorkingDiff: async () => {
    reads++
    return { diff: 'diff --git a/a.ts b/a.ts\n+safe\n', stat: '', staged: false }
  },
  getStagedDiff: async () => ({ diff: '', truncated: false }),
  getUnstagedDiff: async () => ({ diff: '', truncated: false }),
  getBranchDiff: async () => null,
}

const reference = {
  version: 1 as const,
  id: 'selected',
  kind: 'resource',
  uri: localixResourceUri('git', ['p', 'status']),
  freshness: 'resolve-at-send' as const,
  presentation: { label: 'Working status' },
  scope: { userId: 'u', sessionId: 's', projectId: 'p' },
}

describe('Git Context Fabric provider', () => {
  test('captures a revisioned Git snapshot without remote credentials', async () => {
    reads = 0
    const contribution = createGitContextProvider(service)
    const provider = contribution.provider as ContextResolver
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    expect(provider.supports(reference, 'chat')).toBe(true)
    expect(
      provider.supports({ ...reference, uri: localixResourceUri('docker', ['container']) }, 'chat'),
    ).toBe(false)
    const result = await provider.resolve(
      reference,
      { destination: 'chat', userId: 'u', sessionId: 's', projectId: 'p', maxBytes: 10_000 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'git-workspace:git-context',
        sensitivity: 'project',
        uri: reference.uri,
      }),
    ])
    expect(result[0]?.content).toContain('+safe')
    expect(result[0]?.content).not.toContain('https://')
    expect(result[0]?.revision).toMatch(/^git-content:/)
    expect(reads).toBe(1)
  })

  test('does not read after cancellation', async () => {
    reads = 0
    const provider = createGitContextProvider(service).provider as ContextResolver
    const controller = new AbortController()
    controller.abort()
    expect(
      await provider.resolve(
        reference,
        { destination: 'chat', userId: 'u', sessionId: 's', projectId: 'p', maxBytes: 10_000 },
        controller.signal,
      ),
    ).toEqual([])
    expect(reads).toBe(0)
  })
})
