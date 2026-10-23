import { describe, expect, test } from 'bun:test'

import { cleanCommitCompletion, createCommitCompletionSurface } from './inline-completion'

describe('Git Workspace inline completion surface', () => {
  test('owns the namespaced id, fresh context lookup, and prompt fragment', async () => {
    const calls: unknown[][] = []
    const surface = createCommitCompletionSurface({
      getCommitCompletionContext: async (...args: unknown[]) => {
        calls.push(args)
        return {
          branch: 'feature/scoped',
          staged: true,
          files: [
            {
              path: 'src/a.ts',
              status: 'modified',
              staged: true,
              unstaged: false,
              insertions: 1,
              deletions: 1,
            },
          ],
          stat: 'src/a.ts | 2 +-',
          diff: 'diff --git a/src/a.ts b/src/a.ts\n-old\n+new',
          recentMessages: ['fix: prior style'],
        }
      },
    } as never)

    const payload = { draft: 'feat', repoRoot: '/workspace/nested' }
    const contributions = await surface.resolveContext({
      userId: 'u1',
      sessionId: 's1',
      payload,
    })

    expect(calls).toEqual([['u1', 's1', '/workspace/nested', undefined]])
    // One contribution the host admits and clips; its text is what `buildFragment` then receives.
    expect(contributions).toHaveLength(1)
    expect(contributions[0]).toMatchObject({
      providerId: 'git-workspace.commit',
      kind: 'commit-changeset',
    })
    const context = contributions[0]!.content
    expect(context).toContain('Repository branch: feature/scoped')
    expect(context).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(surface.actionable(payload, context)).toBe(true)
    expect(surface.buildFragment(payload, context)).toContain(
      'Current commit-message input: "feat"',
    )
  })

  test('keeps suggestions conventional, single-line, and within the subject limit', () => {
    expect(cleanCommitCompletion('feat(ui): add shared inline completion')).toBe(
      'feat(ui): add shared inline completion',
    )
    expect(cleanCommitCompletion('(ui): add shared inline completion', 'feat')).toBe(
      '(ui): add shared inline completion',
    )
    expect(cleanCommitCompletion('feat(ui): add shared inline completion', 'feat:')).toBe('')
    expect(cleanCommitCompletion('Here is a good commit message', '')).toBe('')
    expect(cleanCommitCompletion('feat: body continuation', 'feat: subject\n')).toBe('')

    const suffix = cleanCommitCompletion(
      'feat(runtime): improve commit completion context with an excessively long tail',
    )
    expect(suffix.length).toBeLessThanOrEqual(72)
    expect(suffix).toMatch(/^feat\(runtime\):/)
  })

  test('rejects malformed or expired requests before reading provider state', async () => {
    let reads = 0
    const surface = createCommitCompletionSurface({
      getCommitCompletionContext: async () => {
        reads++
        return null
      },
    } as never)

    expect(
      await surface.resolveContext({
        userId: 'u1',
        sessionId: 's1',
        payload: { draft: 42 },
      }),
    ).toEqual([])
    expect(
      await surface.resolveContext({
        userId: 'u1',
        sessionId: 's1',
        payload: { draft: '' },
        deadlineAtMs: Date.now() - 1,
      }),
    ).toEqual([])
    expect(reads).toBe(0)
  })
})
