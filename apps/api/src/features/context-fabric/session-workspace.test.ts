import { describe, expect, test } from 'bun:test'

import { resolveContextWorkspace } from './session-workspace'

describe('resolveContextWorkspace', () => {
  test('merges user and project exclusions through one session metadata port', async () => {
    const calls: [string, string][] = []
    const result = await resolveContextWorkspace(
      {
        async resolveSessionWorkspaceMetadata(userId: string, sessionId: string) {
          calls.push([userId, sessionId])
          return { rootPath: '/workspace', projectId: 'project-a' }
        },
        async getProfile() {
          return { agentSettings: { contextExclusions: ['dist', 'shared'] } }
        },
        async getProject() {
          return { settings: { contextExclusions: ['shared', 'generated'] } }
        },
      },
      'user-a',
      'session-a',
    )

    expect(result).toEqual({
      rootPath: '/workspace',
      excludedRelativePaths: ['dist', 'shared', 'generated'],
    })
    expect(calls).toEqual([['user-a', 'session-a']])
  })

  test('a project-less session keeps only the user exclusions', async () => {
    const result = await resolveContextWorkspace(
      {
        resolveSessionWorkspaceMetadata: async () => ({ rootPath: '/sandbox', projectId: null }),
        getProfile: async () => ({ agentSettings: { contextExclusions: ['secrets'] } }),
        getProject: async () => {
          throw new Error('must not be read without a project')
        },
      },
      'user-a',
      'session-a',
    )
    expect(result).toEqual({ rootPath: '/sandbox', excludedRelativePaths: ['secrets'] })
  })
})
