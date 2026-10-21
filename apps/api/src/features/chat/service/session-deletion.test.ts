import { describe, expect, it } from 'bun:test'

import { deleteSession, type SessionDeletionContext } from './session-deletion'
import { popLastFileOp, recordFileOp } from './file-op-journal'

function makeCtx(over: Partial<SessionDeletionContext> = {}) {
  const calls: string[] = []
  const ctx: SessionDeletionContext = {
    repo: {
      deleteSession: async () => {
        calls.push('deleteRow')
      },
      listChildSessionIds: async () => [],
    },
    runner: {
      withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
        operation(),
      stop: async () => true,
      forgetSession: async () => {},
    },
    requireSession: async (_userId: string, id: string) => ({
      id,
      projectId: 'PRJ-1',
      rootSessionId: null,
    }),
    ...over,
  }
  return { ctx, calls }
}

describe('deleteSession', () => {
  it('cleans runtime state for grandchildren before deleting the root', async () => {
    const { ctx, calls } = makeCtx()
    ctx.repo.listChildSessionIds = async (_user, id) =>
      id === 'parent' ? ['child'] : id === 'child' ? ['grandchild'] : []
    ctx.runner.stop = async (id) => {
      calls.push(`stop:${id}`)
      return true
    }
    ctx.runner.forgetSession = async (_user, id) => {
      calls.push(`forget:${id}`)
    }
    await deleteSession(ctx, 'u', 'parent')
    expect(calls).toEqual([
      'stop:grandchild',
      'forget:grandchild',
      'stop:child',
      'forget:child',
      'stop:parent',
      'forget:parent',
      'deleteRow',
    ])
  })

  it('discards plugin session data for the whole tree, after the rows — project session or not', async () => {
    // Plugin data goes for the root and every descendant.
    const { ctx, calls } = makeCtx({
      discardSessionData: async (ids) => {
        calls.push(`data:${ids.join(',')}`)
      },
    })
    ctx.repo.listChildSessionIds = async (_user, id) => (id === 'parent' ? ['child'] : [])
    await deleteSession(ctx, 'u', 'parent')
    expect(calls.slice(-2)).toEqual(['deleteRow', expect.stringMatching(/^data:/)])
    expect(new Set(calls.at(-1)!.slice('data:'.length).split(','))).toEqual(
      new Set(['parent', 'child']),
    )
  })

  it('keeps plugin session data when the deletion fails before the rows go', async () => {
    const { ctx, calls } = makeCtx({
      discardSessionData: async () => {
        calls.push('data')
      },
    })
    ctx.runner.stop = async () => {
      throw new Error('Stop timed out')
    }
    await expect(deleteSession(ctx, 'u', 'parent')).rejects.toThrow('Stop timed out')
    expect(calls).not.toContain('data')
  })

  it('does not interpret a failed child lookup as an empty tree', async () => {
    const { ctx, calls } = makeCtx()
    ctx.repo.listChildSessionIds = async () => {
      throw new Error('database busy')
    }
    ctx.runner.stop = async (id) => {
      calls.push(`stop:${id}`)
      return true
    }
    await expect(deleteSession(ctx, 'u', 'parent')).rejects.toThrow('database busy')
    expect(calls).toEqual([])
  })

  for (const failingId of ['child', 'parent']) {
    it(`retains storage when ${failingId} has not acknowledged stop and permits retry`, async () => {
      const { ctx, calls } = makeCtx()
      ctx.repo.listChildSessionIds = async (_user, id) => (id === 'parent' ? ['child'] : [])
      ctx.runner.stop = async (id) => {
        calls.push(`stop:${id}`)
        if (id === failingId) throw new Error('Stop timed out')
        return true
      }
      ctx.runner.forgetSession = async (_user, id) => {
        calls.push(`forget:${id}`)
      }
      await expect(deleteSession(ctx, 'u', 'parent')).rejects.toThrow('Stop timed out')
      expect(calls).not.toContain('deleteRow')
      expect(calls).not.toContain(`forget:${failingId}`)
      ctx.runner.stop = async () => false // An already idle run needs no further stop.
      await deleteSession(ctx, 'u', 'parent')
      expect(calls.at(-1)).toBe('deleteRow')
    })
  }

  it('tears down children before the parent and deletes storage only after runtime cleanup', async () => {
    const { ctx, calls } = makeCtx()
    ctx.repo.listChildSessionIds = async (_user, id) => (id === 'parent' ? ['child'] : [])
    ctx.runner.stop = async (id) => {
      calls.push(`stop:${id}`)
      return true
    }
    ctx.runner.forgetSession = async (_user, id) => {
      calls.push(`forget:${id}`)
    }
    ctx.closeSessionTerminals = (_user, id) => {
      calls.push(`terminals:${id}`)
    }
    ctx.closeSessionPreview = (_user, id) => {
      calls.push(`preview:${id}`)
    }
    ctx.releaseSessionWatch = (id) => {
      calls.push(`watch:${id}`)
    }
    await deleteSession(ctx, 'u', 'parent')
    expect(calls).toEqual([
      'stop:child',
      'forget:child',
      'terminals:child',
      'preview:child',
      'watch:child',
      'stop:parent',
      'forget:parent',
      'terminals:parent',
      'preview:parent',
      'watch:parent',
      'deleteRow',
    ])
  })

  it("reaps the in-memory file-op Undo journal so its map key can't leak per-session-ever", async () => {
    recordFileOp('LOCALIX-JRNL', {
      kind: 'trash',
      workspaceRoot: '/w',
      original: '/w/a.txt',
      trashPath: '/w/.trash/a.txt',
      entryType: 'file',
    })
    const { ctx } = makeCtx()
    await deleteSession(ctx, 'u1', 'LOCALIX-JRNL')
    // Journal is cleared → nothing left to pop for the deleted session.
    expect(popLastFileOp('LOCALIX-JRNL')).toBeUndefined()
  })
})
